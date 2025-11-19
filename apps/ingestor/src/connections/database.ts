import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Config } from '../config.js';
import * as schema from '../db/schema.js';
import { BaseConnection } from './base/base-connection.js';

const { Pool } = pg;

export type DatabaseClient = {
  pool: pg.Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
};

class DatabaseConnection extends BaseConnection<DatabaseClient> {
  protected createClient(config: Config): DatabaseClient {
    const pool = new Pool({
      connectionString: config.databaseUrl,
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

  async checkHealth(client: DatabaseClient, _config: Config): Promise<boolean> {
    try {
      const connection = await client.pool.connect();
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

// Singleton instance
const databaseConnection = new DatabaseConnection();

// Legacy API for backward compatibility
export function createDatabaseConnection(config: Config): DatabaseClient {
  // Return existing client if already initialized
  if (databaseConnection.isInitialized()) {
    return databaseConnection.getClient();
  }

  // Create client directly since createClient is synchronous
  const client = databaseConnection['createClient'](config);
  databaseConnection['client'] = client;
  return client;
}

// New initialization method that properly handles async
export async function initializeDatabaseConnection(config: Config): Promise<DatabaseClient> {
  return await databaseConnection.initialize(config);
}

export async function checkDatabaseHealth(config: Config): Promise<boolean> {
  if (!databaseConnection.isInitialized()) {
    return false;
  }
  return await databaseConnection.checkHealth(databaseConnection.getClient(), config);
}

export function getDatabase() {
  return databaseConnection.getClient().db;
}

export function getPool() {
  return databaseConnection.getClient().pool;
}

export async function closeDatabaseConnection(): Promise<void> {
  await databaseConnection.close();
}

// Export the connection instance for DI usage
export { databaseConnection };
