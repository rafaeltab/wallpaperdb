import { inject, injectable } from 'tsyringe';
import {
  HealthAggregator,
  type HealthResponse as CoreHealthResponse,
  type ReadyResponse as CoreReadyResponse,
} from '@wallpaperdb/core/health';
import type { Config } from '../config.js';
import { DatabaseConnection } from '../connections/database.js';
import { MinioConnection } from '../connections/minio.js';
import { NatsConnectionManager } from '../connections/nats.js';
import { OpenTelemetryConnection } from '../connections/otel.js';

// Re-export types for backwards compatibility
export type HealthResponse = CoreHealthResponse;
export type ReadyResponse = CoreReadyResponse;

// Legacy interface for backwards compatibility
export interface HealthCheckResult {
  database: boolean;
  minio: boolean;
  nats: boolean;
  otel: boolean;
}

@injectable()
export class HealthService {
  private readonly aggregator: HealthAggregator;

  constructor(
    @inject('config') private readonly config: Config,
    @inject(DatabaseConnection) private readonly databaseConnection: DatabaseConnection,
    @inject(MinioConnection) private readonly minioConnection: MinioConnection,
    @inject(NatsConnectionManager) private readonly natsConnection: NatsConnectionManager,
    @inject(OpenTelemetryConnection) private readonly otelConnection: OpenTelemetryConnection
  ) {
    this.aggregator = new HealthAggregator({ checkTimeoutMs: 5000 });

    // Register health checks
    this.aggregator.register('database', async () => this.databaseConnection.checkHealth());
    this.aggregator.register('minio', async () => this.minioConnection.checkHealth());
    this.aggregator.register('nats', async () => this.natsConnection.checkHealth());

    // OTEL is optional in tests - if disabled, consider it healthy
    if (this.config.nodeEnv === 'test') {
      this.aggregator.register('otel', async () => true);
    } else {
      this.aggregator.register('otel', async () => this.otelConnection.checkHealth());
    }
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
