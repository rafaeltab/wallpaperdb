import {
  NatsConfigSchema,
  OpenSearchConfigSchema,
  OtelConfigSchema,
  RedisConfigSchema,
  ServerConfigSchema,
} from '@wallpaperdb/core/config';
import { z } from 'zod';

// Gateway-specific OpenSearch config (extends shared schema with index field)
const GatewayOpenSearchConfigSchema = OpenSearchConfigSchema.extend({
  opensearchIndex: z.string().min(1),
  opensearchProfileIndex: z.string().min(1).optional(),
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
  mediaPublicBaseUrl: z.string().url().optional(),
  mediaPublicPath: z.string().min(1).default('/media'),

  colorSpreadStrategy: z.enum(['linear', 'exponential', 'exact']).default('linear'),

  // GraphQL Security
  graphqlMaxDepth: z.number().int().positive().default(5),
  graphqlMaxComplexity: z.number().int().positive().default(1000),
  graphqlMaxUniqueFields: z.number().int().positive().default(50),
  graphqlMaxAliases: z.number().int().positive().default(20),
  graphqlMaxBatchSize: z.number().int().positive().default(10),
  graphqlIntrospectionEnabled: z.boolean().default(true),

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

export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): Config {
  const getEnv = (key: string, fallback?: string) => environment[key] ?? fallback;
  const parseIntEnv = (value: string | undefined, fallback?: number) =>
    value === undefined ? fallback : Number(value);
  const booleanEnv = (key: string, fallback: boolean): boolean => {
    const value = environment[key];
    if (value === undefined) return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`Invalid gateway configuration: ${key} must be true or false`);
  };
  const nodeEnv = getEnv('NODE_ENV', 'development');

  const raw = {
    // Server
    port: parseIntEnv(environment.PORT, 3004),
    nodeEnv,

    // OpenSearch
    opensearchUrl: environment.OPENSEARCH_URL,
    opensearchIndex: getEnv('OPENSEARCH_INDEX', 'wallpapers'),
    opensearchProfileIndex: environment.OPENSEARCH_PROFILE_INDEX,
    opensearchPassword: getEnv('OPENSEARCH_PASSWORD'),
    opensearchUsername: getEnv('OPENSEARCH_USERNAME'),

    // NATS
    natsUrl: environment.NATS_URL,
    natsStream: getEnv('NATS_STREAM', 'WALLPAPER'),

    // Redis
    redisHost: environment.REDIS_HOST,
    redisPort: parseIntEnv(environment.REDIS_PORT),
    redisPassword: environment.REDIS_PASSWORD,
    redisEnabled: booleanEnv('REDIS_ENABLED', true),

    // OTEL
    otelEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: getEnv('OTEL_SERVICE_NAME', 'gateway'),

    mediaServiceUrl: getEnv('MEDIA_SERVICE_URL'),
    mediaPublicBaseUrl: environment.MEDIA_PUBLIC_BASE_URL || undefined,
    mediaPublicPath: getEnv('MEDIA_PUBLIC_PATH', '/media'),

    colorSpreadStrategy: getEnv('COLOR_SPREAD_STRATEGY', 'linear'),

    // GraphQL Security
    graphqlMaxDepth: parseIntEnv(environment.GRAPHQL_MAX_DEPTH, 5),
    graphqlMaxComplexity: parseIntEnv(environment.GRAPHQL_MAX_COMPLEXITY, 1000),
    graphqlMaxUniqueFields: parseIntEnv(environment.GRAPHQL_MAX_UNIQUE_FIELDS, 50),
    graphqlMaxAliases: parseIntEnv(environment.GRAPHQL_MAX_ALIASES, 20),
    graphqlMaxBatchSize: parseIntEnv(environment.GRAPHQL_MAX_BATCH_SIZE, 10),
    graphqlIntrospectionEnabled: booleanEnv(
      'GRAPHQL_INTROSPECTION_ENABLED',
      nodeEnv !== 'production'
    ),

    // Rate Limiting
    rateLimitEnabled: booleanEnv('RATE_LIMIT_ENABLED', true),
    rateLimitMaxAnonymous: parseIntEnv(environment.RATE_LIMIT_MAX_ANONYMOUS, 100),
    rateLimitWindowMs: parseIntEnv(environment.RATE_LIMIT_WINDOW_MS, 60000),

    // Cursor Security
    cursorSecret: getEnv('CURSOR_SECRET'),
    cursorExpirationMs: parseIntEnv(
      environment.CURSOR_EXPIRATION_MS,
      7 * 24 * 60 * 60 * 1000 // 7 days
    ),
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid gateway configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`
    );
  }
  return result.data;
}
