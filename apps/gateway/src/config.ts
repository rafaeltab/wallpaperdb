import {
  Config as Configuration,
  ConfigProvider,
  Effect,
  Option,
  Schema,
  SchemaIssue,
} from 'effect';

const urlString = Schema.String.check(
  Schema.makeFilter((value) => URL.canParse(value), { expected: 'an absolute URL' })
);
const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const boundedPort = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));
const positive = (name: string, fallback: number) =>
  Configuration.schema(positiveInteger, name).pipe(Configuration.withDefault(fallback));
const boolean = (name: string, fallback: boolean) =>
  Configuration.Literals(['true', 'false'], name).pipe(
    Configuration.map((value) => value === 'true'),
    Configuration.withDefault(fallback)
  );
const optional = <A>(config: Configuration.Config<A>) =>
  config.pipe(Configuration.option, Configuration.map(Option.getOrUndefined));

export class GatewayConfigurationError extends Schema.TaggedError<GatewayConfigurationError>()(
  'GatewayConfigurationError',
  { message: Schema.String, fields: Schema.Array(Schema.String) }
) {}

const configurationIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function configurationError(error: Configuration.ConfigError): GatewayConfigurationError {
  const fields =
    error.cause._tag === 'SchemaError'
      ? configurationIssues(error.cause.issue).issues.map((issue) =>
          (issue.path ?? [])
            .map((part) => String(typeof part === 'object' ? part.key : part))
            .join('.')
        )
      : [];
  return new GatewayConfigurationError({
    message: 'Invalid gateway configuration',
    fields: [...new Set(fields)],
  });
}

/** Configuration and defaults are resolved once, before constructing the service graph. */
export const gatewayConfig = Effect.gen(function* () {
  const nodeEnv = yield* Configuration.Literals(
    ['development', 'production', 'test'],
    'NODE_ENV'
  ).pipe(Configuration.withDefault('development'));
  return yield* Configuration.all({
    nodeEnv: Configuration.succeed(nodeEnv),
    port: Configuration.schema(boundedPort, 'PORT').pipe(Configuration.withDefault(3004)),
    opensearchUrl: Configuration.schema(urlString, 'OPENSEARCH_URL'),
    opensearchIndex: Configuration.NonEmptyString('OPENSEARCH_INDEX').pipe(
      Configuration.withDefault('wallpapers')
    ),
    opensearchProfileIndex: optional(Configuration.NonEmptyString('OPENSEARCH_PROFILE_INDEX')),
    opensearchUsername: optional(Configuration.String('OPENSEARCH_USERNAME')),
    opensearchPassword: optional(Configuration.Redacted('OPENSEARCH_PASSWORD')),
    natsUrl: Configuration.schema(urlString, 'NATS_URL'),
    natsStream: Configuration.String('NATS_STREAM').pipe(Configuration.withDefault('WALLPAPER')),
    redisHost: Configuration.NonEmptyString('REDIS_HOST').pipe(
      Configuration.withDefault('localhost')
    ),
    redisPort: Configuration.schema(boundedPort, 'REDIS_PORT').pipe(
      Configuration.withDefault(6379)
    ),
    redisPassword: optional(Configuration.Redacted('REDIS_PASSWORD')),
    redisEnabled: boolean('REDIS_ENABLED', true),
    otelEndpoint: optional(Configuration.schema(urlString, 'OTEL_EXPORTER_OTLP_ENDPOINT')),
    otelServiceName: Configuration.NonEmptyString('OTEL_SERVICE_NAME').pipe(
      Configuration.withDefault('gateway')
    ),
    mediaServiceUrl: Configuration.schema(urlString, 'MEDIA_SERVICE_URL'),
    mediaPublicBaseUrl: optional(
      Configuration.schema(Schema.Union([Schema.Literal(''), urlString]), 'MEDIA_PUBLIC_BASE_URL')
    ).pipe(Configuration.map((value) => value || undefined)),
    mediaPublicPath: Configuration.NonEmptyString('MEDIA_PUBLIC_PATH').pipe(
      Configuration.withDefault('/media')
    ),
    colorSpreadStrategy: Configuration.Literals(
      ['linear', 'exponential', 'exact'],
      'COLOR_SPREAD_STRATEGY'
    ).pipe(Configuration.withDefault('linear')),
    graphqlMaxDepth: positive('GRAPHQL_MAX_DEPTH', 5),
    graphqlMaxComplexity: positive('GRAPHQL_MAX_COMPLEXITY', 1000),
    graphqlMaxUniqueFields: positive('GRAPHQL_MAX_UNIQUE_FIELDS', 50),
    graphqlMaxAliases: positive('GRAPHQL_MAX_ALIASES', 20),
    graphqlMaxBatchSize: positive('GRAPHQL_MAX_BATCH_SIZE', 10),
    graphqlIntrospectionEnabled: boolean('GRAPHQL_INTROSPECTION_ENABLED', nodeEnv !== 'production'),
    rateLimitEnabled: boolean('RATE_LIMIT_ENABLED', true),
    rateLimitMaxAnonymous: positive('RATE_LIMIT_MAX_ANONYMOUS', 100),
    rateLimitWindowMs: positive('RATE_LIMIT_WINDOW_MS', 60000),
    cursorSecret: Configuration.schema(
      Schema.Redacted(Schema.String.check(Schema.isMinLength(32))),
      'CURSOR_SECRET'
    ),
    cursorExpirationMs: positive('CURSOR_EXPIRATION_MS', 7 * 24 * 60 * 60 * 1000),
  });
}).pipe(Effect.mapError(configurationError));

export type Config = Effect.Success<typeof gatewayConfig>;

/** Synchronous embedding boundary; production bootstrap evaluates gatewayConfig directly. */
export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): Config {
  return Effect.runSync(
    gatewayConfig.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(environment, { preserveEmptyStrings: true })
      )
    )
  );
}
