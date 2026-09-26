import { NatsConfigSchema, OtelConfigSchema, ServerConfigSchema } from '@wallpaperdb/core/config';
import { z } from 'zod';

function serverUrl(protocols: readonly string[]) {
  return z
    .string()
    .url()
    .pipe(
      z.string().refine((value) => {
        const url = new URL(value);
        return protocols.includes(url.protocol) && url.hostname.length > 0;
      }, 'Expected a server URL with a supported protocol and hostname')
    );
}

const configSchema = z.object({
  ...ServerConfigSchema.shape,
  databaseUrl: serverUrl(['postgres:', 'postgresql:']),
  ...NatsConfigSchema.shape,
  natsUrl: serverUrl(['nats:', 'tls:']),
  ...OtelConfigSchema.shape,
  otelEndpoint: serverUrl(['http:', 'https:']).optional(),
  port: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535)),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): Config {
  return configSchema.parse({
    port: environment.PORT ?? '3008',
    nodeEnv: environment.NODE_ENV ?? 'development',
    databaseUrl: environment.DATABASE_URL,
    natsUrl: environment.NATS_URL,
    natsStream: environment.NATS_STREAM ?? 'WALLPAPER',
    otelEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: environment.OTEL_SERVICE_NAME ?? 'tags',
  });
}
