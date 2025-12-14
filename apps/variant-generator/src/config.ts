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

/**
 * Aspect ratio categories with tolerances.
 * Used to match wallpapers to appropriate resolution presets.
 */
export const ASPECT_RATIO_CATEGORIES = {
  ultrawide: { ratio: 21 / 9, tolerance: 0.1 }, // 2.33 ± 10% → [2.1, 2.56] (21:9, 32:9)
  standard: { ratio: 16 / 9, tolerance: 0.15 }, // 1.78 ± 15% → [1.51, 2.04] (16:9, 16:10)
  phone: { ratio: 9 / 18, tolerance: 0.25 }, // 0.5 ± 25% → [0.375, 0.625] (9:16 to 9:21+)
} as const;

export type AspectRatioCategory = keyof typeof ASPECT_RATIO_CATEGORIES;

/**
 * Resolution preset definition
 */
export interface ResolutionPreset {
  width: number;
  height: number;
  label: string;
}

/**
 * Resolution presets grouped by aspect ratio category.
 * Only presets smaller than the original will be generated.
 */
export const RESOLUTION_PRESETS: Record<AspectRatioCategory, ResolutionPreset[]> = {
  // Standard (16:9) - monitors and TVs
  standard: [
    { width: 3840, height: 2160, label: '4K' },
    { width: 2560, height: 1440, label: '2K/1440p' },
    { width: 1920, height: 1080, label: '1080p' },
    { width: 1600, height: 900, label: '900p' },
    { width: 1280, height: 720, label: '720p' },
    { width: 854, height: 480, label: '480p' },
    { width: 640, height: 360, label: '360p' },
  ],

  // Ultrawide (21:9) - gaming monitors
  ultrawide: [
    { width: 5120, height: 2160, label: '5K Ultrawide' },
    { width: 3440, height: 1440, label: 'UWQHD' },
    { width: 2560, height: 1080, label: 'UWFHD' },
  ],

  // Phone (9:16 and taller) - mobile devices
  phone: [
    { width: 1440, height: 3200, label: 'QHD+ Phone' },
    { width: 1080, height: 2400, label: 'FHD+ Phone' },
    { width: 1080, height: 1920, label: 'FHD Phone' },
    { width: 720, height: 1280, label: 'HD Phone' },
    { width: 480, height: 854, label: 'SD Phone' },
  ],
};

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
  // S3/MinIO config (for reading originals and uploading variants)
  ...S3ConfigSchema.shape,
  // NATS config (event consumer and publisher)
  ...NatsConfigSchema.shape,
  // OTEL config
  ...OtelConfigSchema.shape,
  // Quality settings for image encoding
  ...QualityConfigSchema.shape,
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const nodeEnv = getEnv('NODE_ENV', 'development');

  const raw = {
    // Server
    port: parseIntEnv(process.env.PORT, 3004), // Different port from other services
    nodeEnv,

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
    otelServiceName: getEnv('OTEL_SERVICE_NAME', 'variant-generator'),

    // Quality settings
    jpegQuality: parseIntEnv(process.env.JPEG_QUALITY, 90),
    webpQuality: parseIntEnv(process.env.WEBP_QUALITY, 90),
    pngCompressionLevel: parseIntEnv(process.env.PNG_COMPRESSION_LEVEL, 6),
  };

  return configSchema.parse(raw);
}
