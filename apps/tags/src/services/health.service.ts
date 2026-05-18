import {
  type HealthResponse as CoreHealthResponse,
  type ReadyResponse as CoreReadyResponse,
  HealthAggregator,
} from '@wallpaperdb/core/health';
import { inject, injectable } from 'tsyringe';
import type { Config } from '../config.js';
import { DatabaseConnection } from '../connections/database.js';
import { NatsConnectionManager } from '../connections/nats.js';
import { getOtelSdk } from '../otel-init.js';

export type HealthResponse = CoreHealthResponse;
export type ReadyResponse = CoreReadyResponse;

@injectable()
export class HealthService {
  private readonly aggregator: HealthAggregator;

  constructor(
    @inject('config') private readonly config: Config,
    @inject(DatabaseConnection) private readonly databaseConnection: DatabaseConnection,
    @inject(NatsConnectionManager) private readonly natsConnection: NatsConnectionManager
  ) {
    this.aggregator = new HealthAggregator({ checkTimeoutMs: 5000 });

    this.aggregator.register('database', async () => this.databaseConnection.checkHealth());
    this.aggregator.register('nats', async () => this.natsConnection.checkHealth());

    this.aggregator.register('otel', async () => {
      if (this.config.nodeEnv === 'test') {
        return true;
      }

      if (!this.config.otelEndpoint) {
        return true;
      }

      return getOtelSdk() !== null;
    });
  }

  async checkHealth(isShuttingDown: boolean): Promise<HealthResponse> {
    this.aggregator.setShuttingDown(isShuttingDown);
    const result = await this.aggregator.checkHealth();
    this.aggregator.setShuttingDown(false);
    return result;
  }

  checkReady(isShuttingDown: boolean, connectionsInitialized: boolean): ReadyResponse {
    this.aggregator.setShuttingDown(isShuttingDown);
    this.aggregator.setInitialized(connectionsInitialized);
    const result = this.aggregator.checkReady();
    this.aggregator.setShuttingDown(false);
    this.aggregator.setInitialized(false);
    return result;
  }
}
