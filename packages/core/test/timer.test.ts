import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTimerService, SystemTimerService } from "../src/timer/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// FakeTimerService
// ─────────────────────────────────────────────────────────────────────────────

describe("FakeTimerService", () => {
  let fake: FakeTimerService;

  beforeEach(() => {
    fake = new FakeTimerService();
  });

  // ── setInterval ────────────────────────────────────────────────────────────

  describe("setInterval", () => {
    it("fires callback after tickAsync(interval)", async () => {
      let count = 0;
      fake.setInterval(() => {
        count++;
      }, 100);

      await fake.tickAsync(100);
      expect(count).toBe(1);
    });

    it("fires callback multiple times across multiple ticks", async () => {
      let count = 0;
      fake.setInterval(() => {
        count++;
      }, 100);

      await fake.tickAsync(100);
      await fake.tickAsync(100);
      await fake.tickAsync(100);
      expect(count).toBe(3);
    });

    it("fires multiple times when tick advances by multiple intervals", async () => {
      let count = 0;
      fake.setInterval(() => {
        count++;
      }, 100);

      await fake.tickAsync(300);
      expect(count).toBe(3);
    });

    it("does not fire before the interval elapses", async () => {
      let count = 0;
      fake.setInterval(() => {
        count++;
      }, 100);

      await fake.tickAsync(99);
      expect(count).toBe(0);
    });
  });

  // ── clearInterval ─────────────────────────────────────────────────────────

  describe("clearInterval", () => {
    it("prevents callback from firing after clear", async () => {
      let count = 0;
      const handle = fake.setInterval(() => {
        count++;
      }, 100);

      fake.clearInterval(handle);

      await fake.tickAsync(100);
      expect(count).toBe(0);
    });

    it("stops an already-fired interval from firing again", async () => {
      let count = 0;
      const handle = fake.setInterval(() => {
        count++;
      }, 100);

      await fake.tickAsync(100);
      expect(count).toBe(1);

      fake.clearInterval(handle);

      await fake.tickAsync(100);
      expect(count).toBe(1); // no additional fires
    });
  });

  // ── setTimeout ────────────────────────────────────────────────────────────

  describe("setTimeout", () => {
    it("fires callback once after tickAsync(delay)", async () => {
      let count = 0;
      fake.setTimeout(() => {
        count++;
      }, 200);

      await fake.tickAsync(200);
      expect(count).toBe(1);
    });

    it("does not fire before the delay elapses", async () => {
      let count = 0;
      fake.setTimeout(() => {
        count++;
      }, 200);

      await fake.tickAsync(199);
      expect(count).toBe(0);
    });

    it("does not fire twice even if we tick past the delay multiple times", async () => {
      let count = 0;
      fake.setTimeout(() => {
        count++;
      }, 200);

      await fake.tickAsync(200);
      await fake.tickAsync(200);
      expect(count).toBe(1);
    });
  });

  // ── clearTimeout ─────────────────────────────────────────────────────────

  describe("clearTimeout", () => {
    it("prevents callback from firing", async () => {
      let count = 0;
      const handle = fake.setTimeout(() => {
        count++;
      }, 200);

      fake.clearTimeout(handle);

      await fake.tickAsync(200);
      expect(count).toBe(0);
    });
  });

  // ── async callbacks ───────────────────────────────────────────────────────

  describe("async callback handling", () => {
    it("awaits async interval callback before tickAsync returns", async () => {
      const log: string[] = [];

      fake.setInterval(async () => {
        log.push("start");
        await Promise.resolve(); // microtask boundary
        log.push("end");
      }, 100);

      await fake.tickAsync(100);

      // tickAsync must have awaited the promise before returning
      expect(log).toEqual(["start", "end"]);
    });

    it("awaits async timeout callback before tickAsync returns", async () => {
      const log: string[] = [];

      fake.setTimeout(async () => {
        log.push("start");
        await Promise.resolve();
        log.push("end");
      }, 50);

      await fake.tickAsync(50);

      expect(log).toEqual(["start", "end"]);
    });

    it("awaits multiple async callbacks fired in one tick", async () => {
      const log: string[] = [];

      fake.setInterval(async () => {
        log.push("A");
        await Promise.resolve();
        log.push("A-done");
      }, 50);

      fake.setInterval(async () => {
        log.push("B");
        await Promise.resolve();
        log.push("B-done");
      }, 50);

      await fake.tickAsync(50);

      // Both callbacks must have fully resolved
      expect(log).toContain("A-done");
      expect(log).toContain("B-done");
    });
  });

  // ── callbacks scheduled during a tick ─────────────────────────────────────

  describe("callbacks scheduled during a tick", () => {
    it("handles an interval registered inside another callback", async () => {
      let innerCount = 0;

      fake.setTimeout(() => {
        // Register a new interval during a tick
        fake.setInterval(() => {
          innerCount++;
        }, 50);
      }, 100);

      // Advance past the timeout — the inner interval is registered at t=100
      await fake.tickAsync(100);
      expect(innerCount).toBe(0); // inner interval not yet due

      // Advance by one inner interval period
      await fake.tickAsync(50);
      expect(innerCount).toBe(1);
    });
  });

  // ── getTime ───────────────────────────────────────────────────────────────

  describe("getTime()", () => {
    it("starts at 0", () => {
      expect(fake.getTime()).toBe(0);
    });

    it("advances correctly after tickAsync", async () => {
      await fake.tickAsync(100);
      expect(fake.getTime()).toBe(100);

      await fake.tickAsync(250);
      expect(fake.getTime()).toBe(350);
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  describe("reset()", () => {
    it("resets currentTime to 0", async () => {
      await fake.tickAsync(500);
      expect(fake.getTime()).toBe(500);

      fake.reset();
      expect(fake.getTime()).toBe(0);
    });

    it("clears all registered intervals", async () => {
      let count = 0;
      fake.setInterval(() => {
        count++;
      }, 100);

      fake.reset();

      // After reset the interval is gone; ticking should not fire it
      await fake.tickAsync(300);
      expect(count).toBe(0);
    });

    it("clears all registered timeouts", async () => {
      let count = 0;
      fake.setTimeout(() => {
        count++;
      }, 100);

      fake.reset();

      await fake.tickAsync(300);
      expect(count).toBe(0);
    });

    it("allows new intervals to fire at the expected time after reset", async () => {
      // Advance the clock well past zero, then reset and register a fresh interval.
      await fake.tickAsync(9999);
      fake.reset();

      let count = 0;
      fake.setInterval(() => {
        count++;
      }, 100);

      // After reset, clock is at 0 — the interval fires at t=100
      await fake.tickAsync(100);
      expect(count).toBe(1);

      await fake.tickAsync(200);
      expect(count).toBe(3);
    });

    it("resets handle counter so new handles are assigned cleanly", async () => {
      // Register and clear some handles before the reset
      const h1 = fake.setInterval(() => {}, 50);
      const h2 = fake.setTimeout(() => {}, 50);
      fake.clearInterval(h1);
      fake.clearTimeout(h2);

      fake.reset();

      // Registering new timers after reset should work without errors
      let fired = false;
      fake.setInterval(() => {
        fired = true;
      }, 50);

      await fake.tickAsync(50);
      expect(fired).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SystemTimerService
// ─────────────────────────────────────────────────────────────────────────────

describe("SystemTimerService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("setInterval fires the callback at the correct interval", async () => {
    const service = new SystemTimerService();
    let count = 0;

    const handle = service.setInterval(() => {
      count++;
    }, 100);

    vi.advanceTimersByTime(100);
    expect(count).toBe(1);

    vi.advanceTimersByTime(100);
    expect(count).toBe(2);

    service.clearInterval(handle);
  });

  it("clearInterval stops the callback from firing", () => {
    const service = new SystemTimerService();
    let count = 0;

    const handle = service.setInterval(() => {
      count++;
    }, 100);

    service.clearInterval(handle);

    vi.advanceTimersByTime(500);
    expect(count).toBe(0);
  });

  it("setTimeout fires once then stops", () => {
    const service = new SystemTimerService();
    let count = 0;

    service.setTimeout(() => {
      count++;
    }, 100);

    vi.advanceTimersByTime(100);
    expect(count).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(count).toBe(1); // still 1
  });

  it("clearTimeout prevents the callback from firing", () => {
    const service = new SystemTimerService();
    let count = 0;

    const handle = service.setTimeout(() => {
      count++;
    }, 100);

    service.clearTimeout(handle);

    vi.advanceTimersByTime(500);
    expect(count).toBe(0);
  });
});
