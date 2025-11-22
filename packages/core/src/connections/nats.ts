import { connect, type NatsConnection, type ConnectionOptions } from "nats";
import type { NatsConfig } from "./types.js";

/**
 * Creates a NATS connection.
 *
 * @example
 * ```typescript
 * import { createNatsConnection } from '@wallpaperdb/core/connections';
 *
 * const nc = await createNatsConnection({
 *   natsUrl: config.natsUrl,
 *   serviceName: config.serviceName,
 * });
 * ```
 */
export async function createNatsConnection(
  config: NatsConfig,
  options: Partial<ConnectionOptions> = {}
): Promise<NatsConnection> {
  return connect({
    servers: config.natsUrl,
    name: config.serviceName,
    ...options,
  });
}

/**
 * Checks if a NATS connection is healthy.
 */
export function checkNatsHealth(nc: NatsConnection): boolean {
  return nc.info !== null && !nc.isClosed();
}
