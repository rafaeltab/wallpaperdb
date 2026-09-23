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

export class IngestorConfigurationError extends Schema.TaggedError<IngestorConfigurationError>()(
  'IngestorConfigurationError',
  { message: Schema.String, fields: Schema.Array(Schema.String) }
) {}

const configurationIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function configurationError(error: Configuration.ConfigError): IngestorConfigurationError {
  const fields =
    error.cause._tag === 'SchemaError'
      ? configurationIssues(error.cause.issue).issues.map((issue) =>
          (issue.path ?? [])
            .map((part) => String(typeof part === 'object' ? part.key : part))
            .join('.')
        )
      : [];
  return new IngestorConfigurationError({
    message: 'Invalid ingestor configuration',
    fields: [...new Set(fields)],
  });
}

/** Parse once before constructing adapters; only adapters receive unwrapped secrets. */
export const ingestorConfig = Configuration.all({
  nodeEnv: Configuration.Literals(['development', 'production', 'test'], 'NODE_ENV').pipe(
    Configuration.withDefault('development')
  ),
  port: Configuration.schema(boundedPort, 'PORT').pipe(Configuration.withDefault(3001)),
  databaseUrl: Configuration.Redacted('DATABASE_URL'),
  s3Endpoint: Configuration.schema(urlString, 'S3_ENDPOINT'),
  s3AccessKeyId: Configuration.Redacted('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: Configuration.Redacted('S3_SECRET_ACCESS_KEY'),
  s3Bucket: Configuration.NonEmptyString('S3_BUCKET').pipe(Configuration.withDefault('wallpapers')),
  s3Region: Configuration.NonEmptyString('S3_REGION').pipe(Configuration.withDefault('us-east-1')),
  natsUrl: Configuration.schema(urlString, 'NATS_URL'),
  natsStream: Configuration.NonEmptyString('NATS_STREAM').pipe(
    Configuration.withDefault('WALLPAPER')
  ),
  redisEnabled: boolean('REDIS_ENABLED', true),
  redisHost: Configuration.NonEmptyString('REDIS_HOST').pipe(
    Configuration.withDefault('127.0.0.1')
  ),
  redisPort: Configuration.schema(boundedPort, 'REDIS_PORT').pipe(Configuration.withDefault(6379)),
  redisPassword: optional(Configuration.Redacted('REDIS_PASSWORD')),
  clerkDomain: optional(Configuration.schema(urlString, 'CLERK_DOMAIN')),
  clerkSecretKey: optional(Configuration.Redacted('CLERK_SECRET_KEY')),
  otelEndpoint: optional(Configuration.schema(urlString, 'OTEL_EXPORTER_OTLP_ENDPOINT')),
  otelServiceName: Configuration.NonEmptyString('OTEL_SERVICE_NAME').pipe(
    Configuration.withDefault('ingestor')
  ),
  reconciliationIntervalMs: positive('RECONCILIATION_INTERVAL_MS', 5 * 60 * 1000),
  s3CleanupIntervalMs: positive('S3_CLEANUP_INTERVAL_MS', 24 * 60 * 60 * 1000),
  rateLimitMax: positive('RATE_LIMIT_MAX', 100),
  rateLimitWindowMs: positive('RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000),
}).pipe(Effect.mapError(configurationError));
export type Config = Effect.Success<typeof ingestorConfig>;
export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): Config {
  return Effect.runSync(
    ingestorConfig.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(environment, { preserveEmptyStrings: true })
      )
    )
  );
}
