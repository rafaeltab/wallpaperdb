/**
 * Possible health check statuses.
 */
export type HealthStatus =
	| "healthy"
	| "unhealthy"
	| "degraded"
	| "error"
	| "shutting_down";

/**
 * Result of a single health check.
 */
export interface HealthCheckResult {
	/** Name of the component being checked */
	name: string;
	/** Whether the component is healthy */
	healthy: boolean;
	/** Optional details about the health check */
	details?: string;
	/** Duration of the health check in milliseconds */
	durationMs?: number;
}

/**
 * Aggregated health response.
 */
export interface HealthResponse {
	/** Overall status */
	status: HealthStatus;
	/** Individual component checks */
	checks: Record<string, boolean>;
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Error message if status is 'error' */
	error?: string;
	/** Duration of all checks in milliseconds */
	totalDurationMs?: number;
}

/**
 * Readiness response for Kubernetes-style readiness probes.
 */
export interface ReadyResponse {
	/** Whether the service is ready to accept traffic */
	ready: boolean;
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Reason if not ready */
	reason?: string;
}

/**
 * Liveness response for Kubernetes-style liveness probes.
 */
export interface LiveResponse {
	/** Whether the service is alive */
	alive: boolean;
	/** ISO 8601 timestamp */
	timestamp: string;
}

/**
 * Interface for components that can report health.
 */
export interface HealthCheckable {
	/** Performs a health check */
	checkHealth(): Promise<boolean>;
	/** Name of the component for reporting */
	readonly healthCheckName?: string;
}

/**
 * A health check function that can be registered with the aggregator.
 */
export type HealthCheckFn = () => Promise<boolean>;
