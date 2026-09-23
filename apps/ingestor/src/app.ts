import { Effect, Layer, Redacted } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { AssetsHealth, assetsLayer } from './adapters/assets/index.js';
import { UploadEventsHealth, uploadedEventsLayer } from './adapters/events/index.js';
import { imageInspectionLayer } from './adapters/inspection/index.js';
import { PostgresUploads, postgresUploadsLayer } from './adapters/postgres/index.js';
import { redisQuotaLayer } from './adapters/quota/index.js';
import { admissionLayer } from './admission/index.js';
import { AvailabilityProbe, availabilityLayer } from './availability/index.js';
import type { Config } from './config.js';
import { createHttpApp } from './http/index.js';
import { IngestionIdentity, ingestionLayer } from './ingestion/index.js';
import { ingestorTracingLayer } from './runtime.js';
import { reconciliationLayer } from './workers.js';

interface AppOptions {
  readonly logger?: boolean;
  readonly signal?: AbortSignal;
  readonly shutdownTimeoutMs?: number;
  readonly otelHealthy?: boolean;
}
/** One application graph owns shared adapters, request fibers, and recovery workers. */
export function ingestorLayer(config: Config, options: AppOptions = {}) {
  const database = postgresUploadsLayer({ databaseUrl: Redacted.value(config.databaseUrl) });
  const assets = assetsLayer({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    accessKeyId: Redacted.value(config.s3AccessKeyId),
    secretAccessKey: Redacted.value(config.s3SecretAccessKey),
    bucket: config.s3Bucket,
  });
  const events = uploadedEventsLayer({
    url: config.natsUrl,
    stream: config.natsStream,
    serviceName: config.otelServiceName,
    assetBucket: config.s3Bucket,
  });
  const identity = Layer.succeed(IngestionIdentity, {
    next: () =>
      Effect.sync(() => ({
        wallpaperId: `wlpr_${ulid()}`,
        eventId: ulid(),
        correlationId: ulid(),
        causationId: ulid(),
        leaseToken: ulid(),
      })),
  });
  const ingestion = ingestionLayer().pipe(
    Layer.provide(Layer.mergeAll(database, assets, events, imageInspectionLayer, identity))
  );
  const admission = admissionLayer({
    limit: config.rateLimitMax,
    windowMs: config.rateLimitWindowMs,
  }).pipe(
    Layer.provide(
      redisQuotaLayer({
        redisEnabled: config.redisEnabled,
        redisHost: config.redisHost,
        redisPort: config.redisPort,
        redisPassword:
          config.redisPassword === undefined ? undefined : Redacted.value(config.redisPassword),
      })
    )
  );
  const health = Layer.effect(
    AvailabilityProbe,
    Effect.gen(function* () {
      const database = yield* PostgresUploads;
      const storage = yield* AssetsHealth;
      const events = yield* UploadEventsHealth;
      return AvailabilityProbe.of({
        inspect: () =>
          Effect.all(
            {
              database: database.check(),
              s3: storage.check(),
              nats: events.check(),
              otel: Effect.succeed(!config.otelEndpoint || options.otelHealthy === true),
            },
            { concurrency: 'unbounded' }
          ),
      });
    })
  ).pipe(Layer.provide(Layer.mergeAll(database, assets, events)));
  return Layer.mergeAll(
    ingestion,
    admission,
    availabilityLayer.pipe(Layer.provide(health)),
    reconciliationLayer(config).pipe(Layer.provide(ingestion))
  ).pipe(Layer.provide(ingestorTracingLayer));
}
export async function createApp(
  config: Config,
  options: AppOptions = {}
): Promise<FastifyInstance> {
  const app = await createHttpApp(
    {
      nodeEnv: config.nodeEnv,
      requestTimeoutMs: config.requestTimeoutMs,
      port: config.port,
      rateLimitMax: config.rateLimitMax,
      clerkPublishableKey: config.clerkPublishableKey,
      clerkSecretKey:
        config.clerkSecretKey === undefined ? undefined : Redacted.value(config.clerkSecretKey),
    },
    ingestorLayer(config, options),
    options
  );
  app.connectionsState.connectionsInitialized = true;
  return app;
}
