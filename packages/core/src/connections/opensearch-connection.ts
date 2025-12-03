import { Client, type ClientOptions } from "@opensearch-project/opensearch";
import { BaseConnection } from "./base/base-connection.js";
import type { OpenSearchConfig } from "./types.js";

export interface OpenSearchConnectionOptions {
  /**
   * Whether to reject unauthorized SSL certificates.
   * Default: true in production, false in test environments
   */
  rejectUnauthorized?: boolean;

  /**
   * Number of retries for initial connection
   * @default 2
   */
  retries?: number;

  /**
   * Delay between retries in milliseconds
   * @default 1000
   */
  retryDelay?: number;
}

/**
 * OpenSearch connection manager.
 * Extends BaseConnection to provide lifecycle management for OpenSearch Client.
 *
 * @example
 * ```typescript
 * const connection = new OpenSearchConnection(config);
 * await connection.initialize();
 *
 * const client = connection.getClient();
 * await client.index({...});
 *
 * await connection.close();
 * ```
 */
export class OpenSearchConnection extends BaseConnection<Client, OpenSearchConfig> {
  constructor(
    config: OpenSearchConfig,
    private readonly options: OpenSearchConnectionOptions = {}
  ) {
    super(config);
  }

  protected async createClient(): Promise<Client> {
    const isTest = process.env.NODE_ENV === "test";

    const clientOptions: ClientOptions = {
      node: this.config.opensearchUrl,
    };

    // Add authentication if provided
    if (this.config.opensearchUsername && this.config.opensearchPassword) {
      clientOptions.auth = {
        username: this.config.opensearchUsername,
        password: this.config.opensearchPassword,
      };
    }

    // Configure SSL based on environment and options
    if (this.options.rejectUnauthorized !== undefined || isTest) {
      clientOptions.ssl = {
        rejectUnauthorized: this.options.rejectUnauthorized ?? !isTest,
      };
    }

    const client = new Client(clientOptions);

    // Test connection with retries
    const retries = this.options.retries ?? 2;
    const delay = this.options.retryDelay ?? 1000;

    for (let i = 0; i < retries; i++) {
      try {
        await client.ping();
        return client;
      } catch (error) {
        if (i === retries - 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return client;
  }

  protected async closeClient(client: Client): Promise<void> {
    await client.close();
  }

  /**
   * Check OpenSearch connection health by pinging the cluster
   * and checking cluster health status.
   *
   * @returns true if cluster is accessible and healthy, false otherwise
   */
  async checkHealth(): Promise<boolean> {
    try {
      const client = this.getClient();

      // Ping to check basic connectivity
      await client.ping();

      // Check cluster health
      await client.cluster.health();

      return true;
    } catch (error) {
      console.error("OpenSearch health check failed:", error);
      return false;
    }
  }
}
