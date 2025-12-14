import {
  HealthAggregator,
  type HealthResponse as CoreHealthResponse,
  type ReadyResponse as CoreReadyResponse,
} from '@wallpaperdb/core/health';
import { NatsConnectionManager } from '../connections/nats.js';
import { inject, injectable } from 'tsyringe';
import type { Config } from '../config.js';
import { MinioConnection } from '../connections/minio.js';
import { getOtelSdk } from '../otel-init.js';

// Re-export types for backwards compatibility
export type HealthResponse = CoreHealthResponse;
export type ReadyResponse = CoreReadyResponse;

/**
 * Health service for the variant-generator.
 * Checks connectivity to MinIO and NATS.
 * Note: No database connection since this service is stateless.
 */
@injectable()
export class HealthService {
  private readonly aggregator: HealthAggregator;

  constructor(
    @inject('config') private readonly config: Config,
    @inject(MinioConnection) private readonly minioConnection: MinioConnection,
    @inject(NatsConnectionManager) private readonly natsConnection: NatsConnectionManager
  ) {
    this.aggregator = new HealthAggregator({ checkTimeoutMs: 5000 });

    // Register health checks (no database for stateless service)
    this.aggregator.register('minio', async () => this.minioConnection.checkHealth());
    this.aggregator.register('nats', async () => this.natsConnection.checkHealth());

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
