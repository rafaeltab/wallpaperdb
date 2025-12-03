import { instrumentDrizzleClient } from '@kubiks/otel-drizzle';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { BaseConnection } from './base/base-connection.js';
import type { DatabaseConfig } from './types.js';

const { Pool } = pg;

export interface DatabaseConnectionOptions {
  /** Maximum connections in pool (default: 20) */
  max?: number;
  /** Close idle connections after this many ms (default: 30000) */
  idleTimeoutMillis?: number;
  /** Fail fast if can't get connection within this many ms (default: 2000) */
  connectionTimeoutMillis?: number;
  /** Enable OpenTelemetry instrumentation (default: true) */
  enableOtel?: boolean;
  /** Database system name for OTEL (default: 'postgresql') */
  dbSystem?: string;
  /** Capture query text in OTEL traces (default: true) */
  captureQueryText?: boolean;
  /** Maximum query text length in OTEL traces (default: 2000) */
  maxQueryTextLength?: number;
}

/**
 * Generic type for the database client that includes both pool and drizzle instance.
 *
 * @template TSchema - The Drizzle schema object type
 */
export type DatabaseClient<TSchema extends Record<string, unknown> = Record<string, never>> = {
  pool: pg.Pool;
  db: NodePgDatabase<TSchema>;
};

/**
 * Generic database connection manager for PostgreSQL with Drizzle ORM.
 *
 * Services should extend this class and provide their specific schema type.
 * The schema is passed during construction to maintain type safety.
 *
 * @template TSchema - The Drizzle schema object type
 *
 * @example
 * ```typescript
 * import * as schema from './db/schema.js';
 *
 * // In service-level connection file:
 * @singleton()
 * export class DatabaseConnection extends CoreDatabaseConnection<typeof schema> {
 *   constructor(@inject('config') config: Config) {
 *     super(config, schema);
 *   }
 * }
 * ```
 */
export class DatabaseConnection<
  TSchema extends Record<string, unknown> = Record<string, never>
> extends BaseConnection<DatabaseClient<TSchema>, DatabaseConfig> {
  constructor(
    config: DatabaseConfig,
    private readonly schema: TSchema,
    private readonly options: DatabaseConnectionOptions = {}
  ) {
    super(config);
  }

  protected createClient(): DatabaseClient<TSchema> {
    const pool = new Pool({
      connectionString: this.config.databaseUrl,
      max: this.options.max ?? 20,
      idleTimeoutMillis: this.options.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: this.options.connectionTimeoutMillis ?? 2000,
    });

    const db = drizzle(pool, { schema: this.schema });

    // Instrument Drizzle client for OpenTelemetry tracing
    if (this.options.enableOtel !== false) {
      instrumentDrizzleClient(db, {
        dbSystem: this.options.dbSystem ?? 'postgresql',
        captureQueryText: this.options.captureQueryText ?? true,
        maxQueryTextLength: this.options.maxQueryTextLength ?? 2000,
      });
    }

    return { pool, db };
  }

  protected async closeClient(client: DatabaseClient<TSchema>): Promise<void> {
    await client.pool.end();
  }

  /**
   * Check database connection health by executing a simple query.
   *
   * @returns true if connection is healthy, false otherwise
   */
  async checkHealth(): Promise<boolean> {
    try {
      const connection = await this.getClient().pool.connect();
      await connection.query('SELECT 1');
      connection.release();
      return true;
    } catch (error) {
      // Keep console.error here as this is low-level infrastructure
      // and may be called before logger is initialized
      console.error('Database health check failed:', error);
      return false;
    }
  }
}
