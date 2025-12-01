import { inject, injectable } from 'tsyringe';
import {
  HealthAggregator,
  type HealthResponse as CoreHealthResponse,
  type ReadyResponse as CoreReadyResponse,
} from '@wallpaperdb/core/health';
import type { Config } from '../config.js';
import { OpenSearchConnection } from '../connections/opensearch.js';
import { getOtelSdk } from '../otel-init.js';

// Re-export types for backwards compatibility
export type HealthResponse = CoreHealthResponse;
export type ReadyResponse = CoreReadyResponse;

@injectable()
export class HealthService {
  private readonly aggregator: HealthAggregator;

  constructor(
    @inject('config') private readonly config: Config,
    @inject(OpenSearchConnection) private readonly opensearchConnection: OpenSearchConnection
  ) {
    this.aggregator = new HealthAggregator({ checkTimeoutMs: 5000 });

    // Register health checks
    this.aggregator.register('opensearch', async () => {
      try {
        const client = this.opensearchConnection.getClient();
        await client.ping();
        return true;
      } catch {
        return false;
      }
    });

    // OTEL health check logic:
    // - In test mode: always report healthy (tests don't initialize OTEL)
    // - If OTEL endpoint is NOT configured (disabled): always report healthy (true)
    // - If OTEL endpoint IS configured (enabled): check if SDK is actually running
    this.aggregator.register('otel', async () => {
      // In tests, OTEL is not initialized - this is expected and healthy
      if (this.config.nodeEnv === 'test') {
        return true;
      }

      const isOtelConfigured = !!this.config.otelEndpoint;
      const isOtelRunning = getOtelSdk() !== null;

      if (!isOtelConfigured) {
        // OTEL is disabled - this is fine, report as healthy
        return true;
      }

      // OTEL is configured - check if it's actually running
      return isOtelRunning;
    });
  }

  async checkHealth(isShuttingDown: boolean): Promise<HealthResponse> {
    // Temporarily set shutting down state for this check
    this.aggregator.setShuttingDown(isShuttingDown);
    const result = await this.aggregator.checkHealth();
    // Reset to avoid side effects
    this.aggregator.setShuttingDown(false);
    return result;
  }

  checkReady(isShuttingDown: boolean, connectionsInitialized: boolean): ReadyResponse {
    // Temporarily set states for this check
    this.aggregator.setShuttingDown(isShuttingDown);
    this.aggregator.setInitialized(connectionsInitialized);
    const result = this.aggregator.checkReady();
    // Reset to avoid side effects
    this.aggregator.setShuttingDown(false);
    this.aggregator.setInitialized(false);
    return result;
  }
}
