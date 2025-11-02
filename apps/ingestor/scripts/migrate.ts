import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

// Load environment variables
loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Running migrations...');

    // Read the migration file
    const migrationPath = join(__dirname, '../drizzle/0000_left_starjammers.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Execute the migration
    await pool.query(migrationSQL);

    console.log('✅ Migrations completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
