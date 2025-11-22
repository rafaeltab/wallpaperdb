import type {
	HealthStatus,
	HealthResponse,
	ReadyResponse,
	LiveResponse,
	HealthCheckFn,
} from "./types.js";

export interface HealthAggregatorOptions {
	/** Timeout for individual health checks in ms (default: 5000) */
	checkTimeoutMs?: number;
	/** Whether to run checks in parallel (default: true) */
	parallel?: boolean;
}

/**
 * Aggregates health checks from multiple components.
 *
 * @example
 * ```typescript
 * const healthAggregator = new HealthAggregator();
 *
 * healthAggregator.register("database", async () => {
 *   return await checkPoolHealth(pool);
 * });
 *
 * healthAggregator.register("nats", async () => {
 *   return checkNatsHealth(nc);
 * });
 *
 * const health = await healthAggregator.checkHealth();
 * ```
 */
export class HealthAggregator {
	private checks = new Map<string, HealthCheckFn>();
	private isShuttingDown = false;
	private isInitialized = false;
	private readonly options: Required<HealthAggregatorOptions>;

	constructor(options: HealthAggregatorOptions = {}) {
		this.options = {
			checkTimeoutMs: options.checkTimeoutMs ?? 5000,
			parallel: options.parallel ?? true,
		};
	}

	/**
	 * Registers a health check.
	 */
	register(name: string, check: HealthCheckFn): void {
		this.checks.set(name, check);
	}

	/**
	 * Unregisters a health check.
	 */
	unregister(name: string): void {
		this.checks.delete(name);
	}

	/**
	 * Marks the service as initialized (ready to accept traffic).
	 */
	setInitialized(initialized: boolean): void {
		this.isInitialized = initialized;
	}

	/**
	 * Marks the service as shutting down.
	 */
	setShuttingDown(shuttingDown: boolean): void {
		this.isShuttingDown = shuttingDown;
	}

	/**
	 * Performs all registered health checks and returns aggregated result.
	 */
	async checkHealth(): Promise<HealthResponse> {
		const startTime = Date.now();

		if (this.isShuttingDown) {
			return {
				status: "shutting_down",
				checks: {},
				timestamp: new Date().toISOString(),
			};
		}

		const results: Record<string, boolean> = {};

		try {
			if (this.options.parallel) {
				const entries = Array.from(this.checks.entries());
				const checkResults = await Promise.all(
					entries.map(async ([name, check]) => {
						const healthy = await this.runCheckWithTimeout(name, check);
						return { name, healthy };
					}),
				);

				for (const { name, healthy } of checkResults) {
					results[name] = healthy;
				}
			} else {
				for (const [name, check] of this.checks) {
					results[name] = await this.runCheckWithTimeout(name, check);
				}
			}

			const values = Object.values(results);
			const allHealthy = values.length > 0 && values.every(Boolean);
			const anyHealthy = values.some(Boolean);

			let status: HealthStatus;
			if (values.length === 0 || allHealthy) {
				status = "healthy";
			} else if (anyHealthy) {
				status = "degraded";
			} else {
				status = "unhealthy";
			}

			return {
				status,
				checks: results,
				timestamp: new Date().toISOString(),
				totalDurationMs: Date.now() - startTime,
			};
		} catch (error) {
			return {
				status: "error",
				checks: results,
				timestamp: new Date().toISOString(),
				error: error instanceof Error ? error.message : "Unknown error",
				totalDurationMs: Date.now() - startTime,
			};
		}
	}

	/**
	 * Checks if the service is ready to accept traffic.
	 */
	checkReady(): ReadyResponse {
		if (this.isShuttingDown) {
			return {
				ready: false,
				timestamp: new Date().toISOString(),
				reason: "Service is shutting down",
			};
		}

		if (!this.isInitialized) {
			return {
				ready: false,
				timestamp: new Date().toISOString(),
				reason: "Service is not yet initialized",
			};
		}

		return {
			ready: true,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Checks if the service is alive (process running).
	 */
	checkLive(): LiveResponse {
		return {
			alive: !this.isShuttingDown,
			timestamp: new Date().toISOString(),
		};
	}

	private async runCheckWithTimeout(
		name: string,
		check: HealthCheckFn,
	): Promise<boolean> {
		try {
			const timeoutPromise = new Promise<boolean>((_, reject) => {
				setTimeout(
					() => reject(new Error(`Health check '${name}' timed out`)),
					this.options.checkTimeoutMs,
				);
			});

			return await Promise.race([check(), timeoutPromise]);
		} catch {
			return false;
		}
	}
}
