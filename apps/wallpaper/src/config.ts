import { OtelConfigSchema, ServerConfigSchema } from '@wallpaperdb/core/config';
import { z } from 'zod';
import { readWorkflowConfig, type WorkflowConfig } from './workflow-config.js';

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
  natsUrl: serverUrl(['nats:', 'tls:']),
  ...OtelConfigSchema.shape,
  otelEndpoint: serverUrl(['http:', 'https:']).optional(),
  port: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535)),
});

export type Config = z.infer<typeof configSchema> & { readonly workflow?: WorkflowConfig };

export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): Config {
  const parsed = configSchema.parse({
    port: environment.PORT ?? '3010',
    nodeEnv: environment.NODE_ENV ?? 'development',
    databaseUrl: environment.DATABASE_URL,
    natsUrl: environment.NATS_URL,
    otelEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: environment.OTEL_SERVICE_NAME ?? 'wallpaper',
  });
  if (!environment.WALLPAPER_WORKFLOW_FILE) return parsed;
  try {
    return { ...parsed, workflow: readWorkflowConfig(environment.WALLPAPER_WORKFLOW_FILE) };
  } catch {
    throw new Error('Invalid Wallpaper workflow configuration');
  }
}
