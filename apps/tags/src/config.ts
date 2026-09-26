import {
  DatabaseConfigSchema,
  NatsConfigSchema,
  OtelConfigSchema,
  parseIntEnv,
  ServerConfigSchema,
} from '@wallpaperdb/core/config';
import { z } from 'zod';

const configSchema = z.object({
  ...ServerConfigSchema.shape,
  ...DatabaseConfigSchema.shape,
  ...NatsConfigSchema.shape,
  ...OtelConfigSchema.shape,
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): Config {
  return configSchema.parse({
    port: parseIntEnv(environment.PORT, 3008),
    nodeEnv: environment.NODE_ENV ?? 'development',
    databaseUrl: environment.DATABASE_URL,
    natsUrl: environment.NATS_URL,
    natsStream: environment.NATS_STREAM ?? 'WALLPAPER',
    otelEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: environment.OTEL_SERVICE_NAME ?? 'tags',
  });
}
