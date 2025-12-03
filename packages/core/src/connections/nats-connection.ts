import { connect, type ConnectionOptions, type NatsConnection } from "nats";
import { BaseConnection } from "./base/base-connection.js";
import type { NatsConfig } from "./types.js";

export interface NatsConnectionOptions {
  /** Additional NATS connection options */
  connectionOptions?: Partial<ConnectionOptions>;
}

/**
 * NATS connection manager.
 * Extends BaseConnection to provide lifecycle management for NATS connection.
 *
 * @example
 * ```typescript
 * const connection = new NatsConnectionManager(config);
 * await connection.initialize();
 *
 * const nc = connection.getClient();
 * await nc.publish('subject', 'data');
 *
 * await connection.close();
 * ```
 */
export class NatsConnectionManager extends BaseConnection<NatsConnection, NatsConfig> {
  constructor(
    config: NatsConfig,
    private readonly options: NatsConnectionOptions = {}
  ) {
    super(config);
  }

  protected async createClient(): Promise<NatsConnection> {
    console.log(`Connecting to NATS at '${this.config.natsUrl}'`);

    const client = await connect({
      servers: this.config.natsUrl,
      name: this.config.serviceName,
      ...this.options.connectionOptions,
    });

    console.log("Connected to NATS");
    return client;
  }

  protected async closeClient(client: NatsConnection): Promise<void> {
    await client.close();
  }

  /**
   * Check NATS connection health.
   *
   * @returns true if connection is open and info is available, false otherwise
   */
  async checkHealth(): Promise<boolean> {
    try {
      const info = this.getClient().info;
      return info !== null && !this.getClient().isClosed();
    } catch (error) {
      console.error("NATS health check failed:", error);
      return false;
    }
  }
}
