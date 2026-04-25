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

loadEnv();

const configSchema = z.object({
  ...ServerConfigSchema.shape,
  ...S3ConfigSchema.shape,
  ...NatsConfigSchema.shape,
  ...OtelConfigSchema.shape,
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const nodeEnv = getEnv('NODE_ENV', 'development');

  const raw = {
    port: parseIntEnv(process.env.PORT, 3007),
    nodeEnv,

    s3Endpoint: process.env.S3_ENDPOINT,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3Bucket: getEnv('S3_BUCKET', 'wallpapers'),
    s3Region: getEnv('S3_REGION', 'us-east-1'),

    natsUrl: process.env.NATS_URL,
    natsStream: getEnv('NATS_STREAM', 'WALLPAPER'),

    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: getEnv('OTEL_SERVICE_NAME', 'wallpaperdb-color-extractor'),
  };

  return configSchema.parse(raw);
}
