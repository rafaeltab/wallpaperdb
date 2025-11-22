import pg from "pg";
import type { DatabaseConfig } from "./types.js";

const { Pool } = pg;

export interface PoolOptions {
  /** Maximum connections in pool (default: 20) */
  max?: number;
  /** Close idle connections after this many ms (default: 30000) */
  idleTimeoutMillis?: number;
  /** Fail fast if can't get connection within this many ms (default: 2000) */
  connectionTimeoutMillis?: number;
}

/**
 * Creates a PostgreSQL connection pool with sensible defaults.
 * Services should wrap this with their own Drizzle schema.
 *
 * @example
 * ```typescript
 * import { createPool } from '@wallpaperdb/core/connections';
 * import { drizzle } from 'drizzle-orm/node-postgres';
 * import * as schema from './db/schema.js';
 *
 * const pool = createPool({ databaseUrl: config.databaseUrl });
 * const db = drizzle(pool, { schema });
 * ```
 */
export function createPool(
  config: DatabaseConfig,
  options: PoolOptions = {}
): pg.Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: options.max ?? 20,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 2000,
  });
}

/**
 * Checks if a PostgreSQL pool is healthy by executing a simple query.
 */
export async function checkPoolHealth(pool: pg.Pool): Promise<boolean> {
  try {
    const connection = await pool.connect();
    await connection.query("SELECT 1");
    connection.release();
    return true;
  } catch {
    return false;
  }
}
