import 'dotenv/config';
import pg from 'pg';
import { Effect } from 'effect';
import { migrateIngestionDatabase } from '../src/adapters/postgres/index.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await Effect.runPromise(
    migrateIngestionDatabase(pool, new URL('../drizzle', import.meta.url).pathname)
  );
  console.info('Ingestion migrations completed');
} catch (error) {
  console.error('Ingestion migration failed', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
