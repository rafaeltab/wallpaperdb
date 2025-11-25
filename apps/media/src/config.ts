import {
  DatabaseConfigSchema,
  getEnv,
  NatsConfigSchema,
  OtelConfigSchema,
  parseIntEnv,
  S3ConfigSchema,
  ServerConfigSchema,
} from '@wallpaperdb/core/config';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
loadEnv();

// Compose full config from shared schemas + media-specific fields
const configSchema = z.object({
  // Server config
  ...ServerConfigSchema.shape,
  // Database config
  ...DatabaseConfigSchema.shape,
  // S3/MinIO config (read-only access)
  ...S3ConfigSchema.shape,
  // NATS config (event consumer)
  ...NatsConfigSchema.shape,
  // OTEL config
  ...OtelConfigSchema.shape,
  // Media-specific config (resize limits)
  maxResizeWidth: z.number().int().positive().default(7680), // 8K width
  maxResizeHeight: z.number().int().positive().default(4320), // 8K height
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const nodeEnv = getEnv('NODE_ENV', 'development');

  const raw = {
    // Server
    port: parseIntEnv(process.env.PORT, 3003), // Different port from ingestor (3001) and docs (3002)
    nodeEnv,

    // Database
    databaseUrl: process.env.DATABASE_URL,

    // S3/MinIO (read-only access)
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
    otelServiceName: getEnv('OTEL_SERVICE_NAME', 'media'),

    // Media-specific
    maxResizeWidth: parseIntEnv(process.env.MAX_RESIZE_WIDTH, 7680),
    maxResizeHeight: parseIntEnv(process.env.MAX_RESIZE_HEIGHT, 4320),
  };

  return configSchema.parse(raw);
}
