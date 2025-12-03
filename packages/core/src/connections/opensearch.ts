import { Client, type ClientOptions } from "@opensearch-project/opensearch";
import type { OpenSearchConfig } from "./types.js";

export interface OpenSearchClientOptions {
  /** Whether to reject unauthorized SSL certificates (default: true) */
  rejectUnauthorized?: boolean;
}

/**
 * Creates an OpenSearch client.
 *
 * @example
 * ```typescript
 * import { createOpenSearchClient } from '@wallpaperdb/core/connections';
 *
 * const client = createOpenSearchClient({
 *   opensearchUrl: config.opensearchUrl,
 *   opensearchUsername: config.opensearchUsername,
 *   opensearchPassword: config.opensearchPassword,
 * });
 * ```
 */
export function createOpenSearchClient(
  config: OpenSearchConfig,
  options: OpenSearchClientOptions = {}
): Client {
  const clientOptions: ClientOptions = {
    node: config.opensearchUrl,
  };

  // Add authentication if provided
  if (config.opensearchUsername && config.opensearchPassword) {
    clientOptions.auth = {
      username: config.opensearchUsername,
      password: config.opensearchPassword,
    };
  }

  // Add SSL options if provided
  if (options.rejectUnauthorized !== undefined) {
    clientOptions.ssl = {
      rejectUnauthorized: options.rejectUnauthorized,
    };
  }

  return new Client(clientOptions);
}

/**
 * Checks if an OpenSearch client is healthy by pinging the cluster.
 */
export async function checkOpenSearchHealth(client: Client): Promise<boolean> {
  try {
    await client.ping();
    return true;
  } catch {
    return false;
  }
}
