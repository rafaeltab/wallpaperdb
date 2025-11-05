import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
loadEnv();

const configSchema = z.object({
  // Server
  port: z.number().int().positive().default(3001),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // PostgreSQL
  databaseUrl: z.string().url(),

  // MinIO
  s3Endpoint: z.string().url(),
  s3AccessKeyId: z.string().min(1),
  s3SecretAccessKey: z.string().min(1),
  s3Bucket: z.string().min(1).default('wallpapers'),
  s3Region: z.string().default('us-east-1'),

  // NATS
  natsUrl: z.string().url(),
  natsStream: z.string().default('WALLPAPERS'),

  // OpenTelemetry
  otelEndpoint: z.string().url(),
  otelServiceName: z.string().default('ingestor'),

  // Reconciliation
  reconciliationIntervalMs: z.number().int().positive().default(5 * 60 * 1000), // 5 minutes
  minioCleanupIntervalMs: z.number().int().positive().default(24 * 60 * 60 * 1000), // 24 hours
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isTest = nodeEnv === 'test';

  const raw = {
    port: Number.parseInt(process.env.PORT || '3001', 10),
    nodeEnv,
    databaseUrl: process.env.DATABASE_URL,
    s3Endpoint: process.env.S3_ENDPOINT,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3Bucket: process.env.S3_BUCKET || 'wallpapers',
    s3Region: process.env.S3_REGION || 'us-east-1',
    natsUrl: process.env.NATS_URL,
    natsStream: process.env.NATS_STREAM || 'WALLPAPERS',
    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: process.env.OTEL_SERVICE_NAME || 'ingestor',
    reconciliationIntervalMs: process.env.RECONCILIATION_INTERVAL_MS
      ? Number.parseInt(process.env.RECONCILIATION_INTERVAL_MS, 10)
      : isTest
        ? 100
        : 5 * 60 * 1000,
    minioCleanupIntervalMs: process.env.MINIO_CLEANUP_INTERVAL_MS
      ? Number.parseInt(process.env.MINIO_CLEANUP_INTERVAL_MS, 10)
      : isTest
        ? 500
        : 24 * 60 * 60 * 1000,
  };

  return configSchema.parse(raw);
}
