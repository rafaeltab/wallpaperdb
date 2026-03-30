/**
 * TimerService — abstraction over Node.js timer globals.
 *
 * Inject this into any class that calls setInterval/setTimeout so that tests
 * can swap in FakeTimerService and control time deterministically without
 * touching global timers (which would freeze PostgreSQL, NATS, and MinIO
 * drivers used in integration tests).
 */
export interface TimerService {
    setInterval(callback: () => void | Promise<void>, ms: number): NodeJS.Timeout;
    clearInterval(handle: NodeJS.Timeout): void;
    setTimeout(callback: () => void | Promise<void>, ms: number): NodeJS.Timeout;
    clearTimeout(handle: NodeJS.Timeout): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// SystemTimerService — production implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Production implementation that delegates directly to the Node.js globals.
 */
export class SystemTimerService implements TimerService {
    setInterval(callback: () => void | Promise<void>, ms: number): NodeJS.Timeout {
        return setInterval(callback, ms);
    }

    clearInterval(handle: NodeJS.Timeout): void {
        clearInterval(handle);
    }

    setTimeout(callback: () => void | Promise<void>, ms: number): NodeJS.Timeout {
        return setTimeout(callback, ms);
    }

    clearTimeout(handle: NodeJS.Timeout): void {
        clearTimeout(handle);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// FakeTimerService — test implementation
// ─────────────────────────────────────────────────────────────────────────────

interface IntervalEntry {
    callback: () => void | Promise<void>;
    intervalMs: number;
    nextFireAt: number;
    cleared: boolean;
}

interface TimeoutEntry {
    callback: () => void | Promise<void>;
    fireAt: number;
    cleared: boolean;
    fired: boolean;
}

/**
 * Test implementation with a manually-advanced synthetic clock.
 *
 * Key contract: `tickAsync(ms)` advances the fake clock by `ms` milliseconds,
 * fires **all** due callbacks in chronological order, and `await`s each
 * resulting promise before returning. This means that by the time `tickAsync`
 * resolves, every side-effect triggered by those callbacks (e.g. database
 * writes, NATS publishes) has fully completed.
 */
export class FakeTimerService implements TimerService {
    private currentTime = 0;
    private intervals = new Map<NodeJS.Timeout, IntervalEntry>();
    private timeouts = new Map<NodeJS.Timeout, TimeoutEntry>();
    private nextHandle = 1;

    // ── public API ────────────────────────────────────────────────────────────

    setInterval(
        callback: () => void | Promise<void>,
        ms: number,
    ): NodeJS.Timeout {
        const handle = this.nextHandle++ as unknown as NodeJS.Timeout;
        this.intervals.set(handle, {
            callback,
            intervalMs: ms,
            nextFireAt: this.currentTime + ms,
            cleared: false,
        });
        return handle;
    }

    clearInterval(handle: NodeJS.Timeout): void {
        const entry = this.intervals.get(handle);
        if (entry) {
            entry.cleared = true;
        }
    }

    setTimeout(
        callback: () => void | Promise<void>,
        ms: number,
    ): NodeJS.Timeout {
        const handle = this.nextHandle++ as unknown as NodeJS.Timeout;
        this.timeouts.set(handle, {
            callback,
            fireAt: this.currentTime + ms,
            cleared: false,
            fired: false,
        });
        return handle;
    }

    clearTimeout(handle: NodeJS.Timeout): void {
        const entry = this.timeouts.get(handle);
        if (entry) {
            entry.cleared = true;
        }
    }

    /**
     * Advance the synthetic clock by `ms` milliseconds.
     *
     * All due interval and timeout callbacks are fired in chronological order.
     * Async callbacks are awaited before the next callback is fired (and before
     * tickAsync returns).  Callbacks registered *during* a tick (e.g. a timeout
     * that registers a new interval) are visible to subsequent ticks but do not
     * fire within the current advance unless they are also due within it.
     */
    async tickAsync(ms: number): Promise<void> {
        const targetTime = this.currentTime + ms;

        // We process time step-by-step: find the earliest next event, jump to
        // it, fire it, repeat until we reach targetTime.
        while (this.currentTime < targetTime) {
            const nextEvent = this.findNextEvent(targetTime);

            if (nextEvent === null) {
                // No more events until targetTime — jump straight there.
                this.currentTime = targetTime;
                break;
            }

            // Advance clock to the event's fire time.
            this.currentTime = nextEvent;

            // Collect all callbacks due at exactly currentTime and fire them.
            await this.fireAllDueAt(this.currentTime);
        }
    }

    /**
     * Current synthetic clock value in milliseconds (starts at 0).
     */
    getTime(): number {
        return this.currentTime;
    }

    /**
     * Reset the fake timer to its initial state (currentTime = 0, no registered
     * intervals or timeouts). Call this in beforeEach to give each test a
     * clean clock.
     */
    reset(): void {
        this.currentTime = 0;
        this.intervals.clear();
        this.timeouts.clear();
        this.nextHandle = 1;
    }

    // ── private helpers ───────────────────────────────────────────────────────

    /**
     * Returns the earliest fire time of any pending event that is ≤ ceiling,
     * or null if there are none.
     */
    private findNextEvent(ceiling: number): number | null {
        let earliest: number | null = null;

        for (const entry of this.intervals.values()) {
            if (!entry.cleared && entry.nextFireAt <= ceiling) {
                if (earliest === null || entry.nextFireAt < earliest) {
                    earliest = entry.nextFireAt;
                }
            }
        }

        for (const entry of this.timeouts.values()) {
            if (!entry.cleared && !entry.fired && entry.fireAt <= ceiling) {
                if (earliest === null || entry.fireAt < earliest) {
                    earliest = entry.fireAt;
                }
            }
        }

        return earliest;
    }

    /**
     * Fire (and await) all callbacks whose fire time equals `at`.
     * Intervals have their nextFireAt bumped forwards after firing.
     */
    private async fireAllDueAt(at: number): Promise<void> {
        // Snapshot current keys so callbacks that register new entries during
        // this tick don't get processed in the same batch.
        const intervalKeys = Array.from(this.intervals.keys());
        const timeoutKeys = Array.from(this.timeouts.keys());

        for (const key of intervalKeys) {
            const entry = this.intervals.get(key);
            if (!entry || entry.cleared || entry.nextFireAt !== at) {
                continue;
            }
            // Bump schedule before firing so re-entrant clears are respected.
            entry.nextFireAt = at + entry.intervalMs;
            const result = entry.callback();
            if (result instanceof Promise) {
                await result;
            }
        }

        for (const key of timeoutKeys) {
            const entry = this.timeouts.get(key);
            if (!entry || entry.cleared || entry.fired || entry.fireAt !== at) {
                continue;
            }
            entry.fired = true;
            const result = entry.callback();
            if (result instanceof Promise) {
                await result;
            }
        }
    }
}
