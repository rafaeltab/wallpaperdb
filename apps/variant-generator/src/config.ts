import {
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

// Quality settings schema
const QualityConfigSchema = z.object({
  jpegQuality: z.number().int().min(1).max(100).default(90),
  webpQuality: z.number().int().min(1).max(100).default(90),
  pngCompressionLevel: z.number().int().min(0).max(9).default(6),
});

// Compose full config from shared schemas + variant-generator-specific fields
const configSchema = z.object({
  // Server config
  ...ServerConfigSchema.shape,
  // S3 config (for reading originals and uploading variants)
  ...S3ConfigSchema.shape,
  // NATS config (event consumer and publisher)
  ...NatsConfigSchema.shape,
  // OTEL config
  ...OtelConfigSchema.shape,
  // Quality settings for image encoding
  ...QualityConfigSchema.shape,
  assetReferenceBucket: z.string().min(1).default('asset-references'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const nodeEnv = getEnv('NODE_ENV', 'development');

  const raw = {
    // Server
    port: parseIntEnv(process.env.PORT, 3006), // Different port from other services
    nodeEnv,

    // S3
    s3Endpoint: process.env.S3_ENDPOINT,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3Bucket: getEnv('S3_BUCKET', 'wallpapers'),
    s3Region: getEnv('S3_REGION', 'us-east-1'),
    assetReferenceBucket: getEnv('ASSET_REFERENCE_BUCKET', 'asset-references'),

    // NATS
    natsUrl: process.env.NATS_URL,
    natsStream: getEnv('NATS_STREAM', 'WALLPAPER'),

    // OTEL
    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: getEnv('OTEL_SERVICE_NAME', 'variant-generator'),

    // Quality settings
    jpegQuality: parseIntEnv(process.env.JPEG_QUALITY, 90),
    webpQuality: parseIntEnv(process.env.WEBP_QUALITY, 90),
    pngCompressionLevel: parseIntEnv(process.env.PNG_COMPRESSION_LEVEL, 6),
  };

  return configSchema.parse(raw);
}
