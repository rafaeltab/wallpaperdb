import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import * as schema from '../db/schema.js';
import { BaseConnection } from './base/base-connection.js';

const { Pool } = pg;

export type DatabaseClient = {
  pool: pg.Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
};

@singleton()
export class DatabaseConnection extends BaseConnection<DatabaseClient, Config> {
  constructor(@inject('config') config: Config) {
    super(config);
  }

  protected createClient(): DatabaseClient {
    const pool = new Pool({
      connectionString: this.config.databaseUrl,
      max: 20, // Maximum connections in pool
      idleTimeoutMillis: 30000, // Close idle connections after 30s
      connectionTimeoutMillis: 2000, // Fail fast if can't get connection
    });

    const db = drizzle(pool, { schema });

    return { pool, db };
  }

  protected async closeClient(client: DatabaseClient): Promise<void> {
    await client.pool.end();
  }

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
