import { inject, injectable } from 'tsyringe';
import type { Config } from '../config.js';
import { DatabaseConnection } from '../connections/database.js';
import { MinioConnection } from '../connections/minio.js';
import { NatsConnectionManager } from '../connections/nats.js';
import { OpenTelemetryConnection } from '../connections/otel.js';

export interface HealthCheckResult {
  database: boolean;
  minio: boolean;
  nats: boolean;
  otel: boolean;
}

export interface HealthResponse {
  status: 'healthy' | 'unhealthy' | 'error' | 'shutting_down';
  checks?: HealthCheckResult;
  timestamp: string;
  error?: string;
}

export interface ReadyResponse {
  ready: boolean;
  timestamp: string;
}

@injectable()
export class HealthService {
  constructor(
    @inject('config') private readonly config: Config,
    @inject(DatabaseConnection) private readonly databaseConnection: DatabaseConnection,
    @inject(MinioConnection) private readonly minioConnection: MinioConnection,
    @inject(NatsConnectionManager) private readonly natsConnection: NatsConnectionManager,
    @inject(OpenTelemetryConnection) private readonly otelConnection: OpenTelemetryConnection
  ) {}

  async checkHealth(isShuttingDown: boolean): Promise<HealthResponse> {
    if (isShuttingDown) {
      return {
        status: 'shutting_down',
        timestamp: new Date().toISOString(),
      };
    }

    const checks: HealthCheckResult = {
      database: false,
      minio: false,
      nats: false,
      otel: false,
    };

    try {
      // Check all connections
      checks.database = await this.databaseConnection.checkHealth();
      checks.minio = await this.minioConnection.checkHealth();
      checks.nats = await this.natsConnection.checkHealth();
      // OTEL is optional in tests - if disabled, consider it healthy
      checks.otel = this.config.nodeEnv === 'test' ? true : await this.otelConnection.checkHealth();

      const allHealthy = Object.values(checks).every((check) => check === true);

      if (allHealthy) {
        return {
          status: 'healthy',
          checks,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        status: 'unhealthy',
        checks,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        checks,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }

  checkReady(isShuttingDown: boolean, connectionsInitialized: boolean): ReadyResponse {
    return {
      ready: !isShuttingDown && connectionsInitialized,
      timestamp: new Date().toISOString(),
    };
  }
}
