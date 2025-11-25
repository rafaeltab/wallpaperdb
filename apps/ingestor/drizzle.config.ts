import { defineConfig } from 'drizzle-kit';
import { config as loadEnv } from 'dotenv';

// Load environment variables
loadEnv();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://wallpaperdb:wallpaperdb@localhost:5432/wallpaperdb_ingestor',
  },
  verbose: true,
  strict: true,
});
