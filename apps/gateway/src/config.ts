import {
  getEnv,
  NatsConfigSchema,
  OpenSearchConfigSchema,
  OtelConfigSchema,
  parseIntEnv,
  RedisConfigSchema,
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
  // Redis config
  ...RedisConfigSchema.shape,
  // OTEL config
  ...OtelConfigSchema.shape,
  mediaServiceUrl: z.string().url(),

  // GraphQL Security
  graphqlMaxDepth: z.number().int().positive().default(5),
  graphqlMaxComplexity: z.number().int().positive().default(1000),
  graphqlMaxUniqueFields: z.number().int().positive().default(50),
  graphqlMaxAliases: z.number().int().positive().default(20),
  graphqlMaxBatchSize: z.number().int().positive().default(10),
  graphqlIntrospectionEnabled: z.boolean().default(process.env.NODE_ENV !== 'production'),

  // Rate Limiting
  rateLimitEnabled: z.boolean().default(true),
  rateLimitMaxAnonymous: z.number().int().positive().default(100),
  rateLimitWindowMs: z.number().int().positive().default(60000),

  // Cursor Security
  cursorSecret: z.string().min(32),
  cursorExpirationMs: z
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60 * 1000), // 7 days
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

    // Redis
    redisHost: getEnv('REDIS_HOST', 'localhost'),
    redisPort: parseIntEnv(process.env.REDIS_PORT, 6379),
    redisPassword: process.env.REDIS_PASSWORD,
    redisEnabled: getEnv('REDIS_ENABLED', 'true') === 'true',

    // OTEL
    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: getEnv('OTEL_SERVICE_NAME', 'gateway'),

    mediaServiceUrl: getEnv('MEDIA_SERVICE_URL'),

    // GraphQL Security
    graphqlMaxDepth: parseIntEnv(process.env.GRAPHQL_MAX_DEPTH, 5),
    graphqlMaxComplexity: parseIntEnv(process.env.GRAPHQL_MAX_COMPLEXITY, 1000),
    graphqlMaxUniqueFields: parseIntEnv(process.env.GRAPHQL_MAX_UNIQUE_FIELDS, 50),
    graphqlMaxAliases: parseIntEnv(process.env.GRAPHQL_MAX_ALIASES, 20),
    graphqlMaxBatchSize: parseIntEnv(process.env.GRAPHQL_MAX_BATCH_SIZE, 10),
    graphqlIntrospectionEnabled:
      getEnv('GRAPHQL_INTROSPECTION_ENABLED', nodeEnv !== 'production' ? 'true' : 'false') ===
      'true',

    // Rate Limiting
    rateLimitEnabled: getEnv('RATE_LIMIT_ENABLED', 'true') === 'true',
    rateLimitMaxAnonymous: parseIntEnv(process.env.RATE_LIMIT_MAX_ANONYMOUS, 100),
    rateLimitWindowMs: parseIntEnv(process.env.RATE_LIMIT_WINDOW_MS, 60000),

    // Cursor Security
    cursorSecret: getEnv('CURSOR_SECRET'),
    cursorExpirationMs: parseIntEnv(
      process.env.CURSOR_EXPIRATION_MS,
      7 * 24 * 60 * 60 * 1000 // 7 days
    ),
  };

  return configSchema.parse(raw);
}
