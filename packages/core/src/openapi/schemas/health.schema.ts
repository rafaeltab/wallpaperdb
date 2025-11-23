import { z } from "zod";
import { zodToJsonSchema } from "../utils/zod-to-json-schema.js";

/**
 * Possible health check statuses.
 */
export const HealthStatusSchema = z.enum([
  "healthy",
  "unhealthy",
  "degraded",
  "error",
  "shutting_down",
]);

/**
 * Health response schema for OpenAPI documentation.
 */
export const HealthResponseSchema = z.object({
  /** Overall status */
  status: HealthStatusSchema.describe("Overall health status of the service"),
  /** Individual component checks */
  checks: z.record(z.string(), z.boolean()).describe("Individual component health checks"),
  /** ISO 8601 timestamp */
  timestamp: z.string().describe("ISO 8601 timestamp of the health check"),
  /** Error message if status is 'error' */
  error: z.string().optional().describe("Error message if status is 'error'"),
  /** Duration of all checks in milliseconds */
  totalDurationMs: z.number().optional().describe("Duration of all checks in milliseconds"),
});

/**
 * Ready response schema for Kubernetes-style readiness probes.
 */
export const ReadyResponseSchema = z.object({
  /** Whether the service is ready to accept traffic */
  ready: z.boolean().describe("Whether the service is ready to accept traffic"),
  /** ISO 8601 timestamp */
  timestamp: z.string().describe("ISO 8601 timestamp of the readiness check"),
  /** Reason if not ready */
  reason: z.string().optional().describe("Reason if service is not ready"),
});

/**
 * Liveness response schema for Kubernetes-style liveness probes.
 */
export const LiveResponseSchema = z.object({
  /** Whether the service is alive */
  alive: z.boolean().describe("Whether the service is alive"),
  /** ISO 8601 timestamp */
  timestamp: z.string().describe("ISO 8601 timestamp of the liveness check"),
});

// Export types inferred from schemas
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
export type LiveResponse = z.infer<typeof LiveResponseSchema>;

// Export JSON Schema versions for OpenAPI
export const HealthResponseJsonSchema = zodToJsonSchema(HealthResponseSchema, {
  name: "HealthResponse",
});
export const ReadyResponseJsonSchema = zodToJsonSchema(ReadyResponseSchema, {
  name: "ReadyResponse",
});
export const LiveResponseJsonSchema = zodToJsonSchema(LiveResponseSchema, {
  name: "LiveResponse",
});
