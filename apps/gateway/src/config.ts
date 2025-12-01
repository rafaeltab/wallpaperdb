import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import {
  ServerConfigSchema,
  NatsConfigSchema,
  OtelConfigSchema,
  parseIntEnv,
  getEnv,
} from '@wallpaperdb/core/config';

// Load environment variables from .env file
loadEnv();

// OpenSearch config schema
const OpenSearchConfigSchema = z.object({
  opensearchUrl: z.string().url(),
  opensearchIndex: z.string().min(1),
  opensearchUsername: z.string(),
  opensearchPassword: z.string(),
});

// Compose full config from shared schemas + gateway-specific fields
const configSchema = z.object({
  // Server config
  ...ServerConfigSchema.shape,
  // OpenSearch config
  ...OpenSearchConfigSchema.shape,
  // NATS config
  ...NatsConfigSchema.shape,
  // OTEL config
  ...OtelConfigSchema.shape,
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const nodeEnv = getEnv('NODE_ENV', 'development');

  const raw = {
    // Server
    port: parseIntEnv(process.env.PORT, 3004),
    nodeEnv,

    // OpenSearch
    opensearchUrl: getEnv('OPENSEARCH_URL', 'http://localhost:9200'),
    opensearchIndex: getEnv('OPENSEARCH_INDEX', 'wallpapers'),
    opensearchPassword: getEnv('OPENSEARCH_PASSWORD'),
    opensearchUsername: getEnv('OPENSEARCH_USERNAME'),

    // NATS
    natsUrl: process.env.NATS_URL,
    natsStream: getEnv('NATS_STREAM', 'WALLPAPER'),

    // OTEL
    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: getEnv('OTEL_SERVICE_NAME', 'gateway'),
  };

  return configSchema.parse(raw);
}
