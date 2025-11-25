import {
  type HealthResponse as CoreHealthResponse,
  type ReadyResponse as CoreReadyResponse,
  HealthAggregator,
} from '@wallpaperdb/core/health';
import { inject, injectable } from 'tsyringe';
import type { Config } from '../config.js';
import { DatabaseConnection } from '../connections/database.js';
import { MinioConnection } from '../connections/minio.js';
import { NatsConnectionManager } from '../connections/nats.js';

// Re-export types for consistency
export type HealthResponse = CoreHealthResponse;
export type ReadyResponse = CoreReadyResponse;

@injectable()
export class HealthService {
  private readonly aggregator: HealthAggregator;

  constructor(
    @inject('config') _config: Config,
    @inject(DatabaseConnection) private readonly databaseConnection: DatabaseConnection,
    @inject(MinioConnection) private readonly minioConnection: MinioConnection,
    @inject(NatsConnectionManager) private readonly natsConnection: NatsConnectionManager
  ) {
    this.aggregator = new HealthAggregator({ checkTimeoutMs: 5000 });

    // Register health checks for media service dependencies
    this.aggregator.register('database', async () => this.databaseConnection.checkHealth());
    this.aggregator.register('minio', async () => this.minioConnection.checkHealth());
    this.aggregator.register('nats', async () => this.natsConnection.checkHealth());
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
