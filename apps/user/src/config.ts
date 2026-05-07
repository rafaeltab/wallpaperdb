import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import {
  ServerConfigSchema,
  DatabaseConfigSchema,
  NatsConfigSchema,
  OtelConfigSchema,
  parseIntEnv,
  getEnv,
} from '@wallpaperdb/core/config';

loadEnv();

const configSchema = z.object({
  ...ServerConfigSchema.shape,
  ...DatabaseConfigSchema.shape,
  ...NatsConfigSchema.shape,
  ...OtelConfigSchema.shape,
  clerkSecretKey: z.string().min(1).optional(),
  clerkPublishableKey: z.string().min(1).optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const nodeEnv = getEnv('NODE_ENV', 'development');

  const raw = {
    port: parseIntEnv(process.env.PORT, 3009),
    nodeEnv,
    databaseUrl: process.env.DATABASE_URL,
    natsUrl: process.env.NATS_URL,
    natsStream: getEnv('NATS_STREAM', 'WALLPAPER'),
    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: getEnv('OTEL_SERVICE_NAME', 'user'),
    clerkSecretKey: process.env.CLERK_SECRET_KEY,
    clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  };

  return configSchema.parse(raw);
}
