import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import {
  ServerConfigSchema,
  DatabaseConfigSchema,
  S3ConfigSchema,
  NatsConfigSchema,
  RedisConfigSchema,
  OtelConfigSchema,
  parseIntEnv,
  parseBoolEnv,
  getEnv,
} from '@wallpaperdb/core/config';

// Load environment variables from .env file
loadEnv();

// Compose full config from shared schemas + ingestor-specific fields
const configSchema = z.object({
  // Server config
  ...ServerConfigSchema.shape,
  // Database config
  ...DatabaseConfigSchema.shape,
  // S3/MinIO config
  ...S3ConfigSchema.shape,
  // NATS config
  ...NatsConfigSchema.shape,
  // Redis config
  ...RedisConfigSchema.shape,
  // OTEL config
  ...OtelConfigSchema.shape,
  // Ingestor-specific config (reconciliation, rate limiting)
  reconciliationIntervalMs: z
    .number()
    .int()
    .positive()
    .default(5 * 60 * 1000), // 5 minutes
  minioCleanupIntervalMs: z
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60 * 1000), // 24 hours
  rateLimitMax: z.number().int().positive().default(100), // Max uploads per window
  rateLimitWindowMs: z
    .number()
    .int()
    .positive()
    .default(60 * 60 * 1000), // 1 hour
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const nodeEnv = getEnv('NODE_ENV', 'development');
  const isTest = nodeEnv === 'test';

  const raw = {
    // Server
    port: parseIntEnv(process.env.PORT, 3001),
    nodeEnv,

    // Database
    databaseUrl: process.env.DATABASE_URL,

    // S3/MinIO
    s3Endpoint: process.env.S3_ENDPOINT,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3Bucket: getEnv('S3_BUCKET', 'wallpapers'),
    s3Region: getEnv('S3_REGION', 'us-east-1'),

    // NATS
    natsUrl: process.env.NATS_URL,
    natsStream: getEnv('NATS_STREAM', 'WALLPAPER'),

    // OTEL
    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: getEnv('OTEL_SERVICE_NAME', 'ingestor'),

    // Redis
    redisHost: getEnv('REDIS_HOST', 'localhost'),
    redisPort: parseIntEnv(process.env.REDIS_PORT, 6379),
    redisPassword: process.env.REDIS_PASSWORD,
    redisEnabled: parseBoolEnv(process.env.REDIS_ENABLED, true),

    // Ingestor-specific
    reconciliationIntervalMs: parseIntEnv(
      process.env.RECONCILIATION_INTERVAL_MS,
      isTest ? 100 : 5 * 60 * 1000
    ),
    minioCleanupIntervalMs: parseIntEnv(
      process.env.MINIO_CLEANUP_INTERVAL_MS,
      isTest ? 500 : 24 * 60 * 60 * 1000
    ),
    rateLimitMax: parseIntEnv(process.env.RATE_LIMIT_MAX, 100),
    rateLimitWindowMs: parseIntEnv(process.env.RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),
  };

  return configSchema.parse(raw);
}
