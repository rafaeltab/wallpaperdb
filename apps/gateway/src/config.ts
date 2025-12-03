import {
  getEnv,
  NatsConfigSchema,
  OpenSearchConfigSchema,
  OtelConfigSchema,
  parseIntEnv,
  ServerConfigSchema,
} from '@wallpaperdb/core/config';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
loadEnv();

// Gateway-specific OpenSearch config (extends shared schema with index field)
const GatewayOpenSearchConfigSchema = OpenSearchConfigSchema.extend({
  opensearchIndex: z.string().min(1),
});

// Compose full config from shared schemas + gateway-specific fields
const configSchema = z.object({
  // Server config
  ...ServerConfigSchema.shape,
  // OpenSearch config (with gateway-specific index field)
  ...GatewayOpenSearchConfigSchema.shape,
  // NATS config
  ...NatsConfigSchema.shape,
  // OTEL config
  ...OtelConfigSchema.shape,
  mediaServiceUrl: z.string().url(),
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

    mediaServiceUrl: getEnv('MEDIA_SERVICE_URL'),
  };

  return configSchema.parse(raw);
}
