import type { HealthResponse, ReadyResponse, LiveResponse } from "./types.js";

/**
 * Determines the HTTP status code for a health response.
 */
export function getHealthStatusCode(response: HealthResponse): number {
  switch (response.status) {
    case "healthy":
      return 200;
    case "degraded":
      return 200; // Degraded is still operational
    case "unhealthy":
    case "error":
    case "shutting_down":
      return 503;
    default:
      return 500;
  }
}

/**
 * Determines the HTTP status code for a ready response.
 */
export function getReadyStatusCode(response: ReadyResponse): number {
  return response.ready ? 200 : 503;
}

/**
 * Determines the HTTP status code for a live response.
 */
export function getLiveStatusCode(response: LiveResponse): number {
  return response.alive ? 200 : 503;
}

/**
 * Creates a minimal health response for simple /health endpoints.
 */
export function createSimpleHealthResponse(healthy: boolean): {
  status: "healthy" | "unhealthy";
  timestamp: string;
} {
  return {
    status: healthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
  };
}
