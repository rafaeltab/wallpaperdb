import { defineConfig } from 'drizzle-kit';
import { config as loadEnv } from 'dotenv';

// Load environment variables
loadEnv();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? (() => { throw new Error('DATABASE_URL environment variable is required') })(),
  },
  verbose: true,
  strict: true,
});
