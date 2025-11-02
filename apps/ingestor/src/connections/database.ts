import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Config } from '../config.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function createDatabaseConnection(config: Config) {
  if (pool && db) {
    return { pool, db };
  }

  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 20, // Maximum connections in pool
    idleTimeoutMillis: 30000, // Close idle connections after 30s
    connectionTimeoutMillis: 2000, // Fail fast if can't get connection
  });

  db = drizzle(pool);

  return { pool, db };
}

export async function checkDatabaseHealth(): Promise<boolean> {
  if (!pool) {
    return false;
  }

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

export async function closeDatabaseConnection(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
