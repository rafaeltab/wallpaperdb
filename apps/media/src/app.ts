import { Effect, Layer } from 'effect';
import type { FastifyInstance } from 'fastify';
import {
  AssetHealth,
  pictureAuthorityLayer,
  s3AssetsLayer,
  sharpTransformerLayer,
} from './adapters/assets/index.js';
import { CatalogPostgresLayer } from './adapters/catalog/index.js';
import {
  ConsumerHealth,
  EventsHealth,
  OutboxHealth,
  natsConsumerLayer,
  natsEventsLayer,
  natsOutboxLayer,
} from './adapters/events/index.js';
import { AvailabilityProbe, availabilityLayer } from './availability/index.js';
import { CatalogHealth } from './catalog/index.js';
import type { Config } from './config.js';
import { deliveryLayer } from './delivery/index.js';
import { createHttpApp } from './http/index.js';
import { tracingLayer } from './runtime.js';

interface AppOptions {
  readonly logger?: boolean;
  readonly signal?: AbortSignal;
  readonly otelHealthy?: boolean;
  readonly shutdownTimeoutMs?: number;
}
export function mediaLayer(config: Config, options: AppOptions = {}) {
  const catalog = CatalogPostgresLayer({
    databaseUrl: config.databaseUrl,
    assetReferences: {
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
      bucket: config.assetReferenceBucket,
    },
  });
  const assets = s3AssetsLayer({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
    bucket: config.s3Bucket,
  });
  const delivery = deliveryLayer({
    maxResizeWidth: config.maxResizeWidth,
    maxResizeHeight: config.maxResizeHeight,
    maxOutputPixels: config.maxResizeWidth * config.maxResizeHeight,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        catalog,
        assets,
        sharpTransformerLayer({ maxInputPixels: 268402689 }),
        pictureAuthorityLayer({
          origin: config.userServiceUrl,
          token: config.userMediaServiceToken,
        })
      )
    )
  );
  const eventOptions = {
    url: config.natsUrl,
    stream: config.natsStream,
    serviceName: config.otelServiceName,
    shutdownTimeoutMs: options.shutdownTimeoutMs,
  };
  const events = natsEventsLayer(eventOptions);
  const consumers = natsConsumerLayer(eventOptions).pipe(
    Layer.provide(Layer.merge(catalog, events))
  );
  const outbox = natsOutboxLayer(eventOptions).pipe(Layer.provide(Layer.merge(catalog, events)));
  const probe = Layer.effect(
    AvailabilityProbe,
    Effect.gen(function* () {
      const storage = yield* AssetHealth;
      const database = yield* CatalogHealth;
      const broker = yield* EventsHealth;
      const consumer = yield* ConsumerHealth;
      const publisher = yield* OutboxHealth;
      return AvailabilityProbe.of({
        inspect: () =>
          Effect.all(
            {
              database: database.check,
              s3: storage
                .check()
                .pipe(
                  Effect.timeout('5 seconds'),
                  Effect.match({ onSuccess: () => true, onFailure: () => false })
                ),
              nats: broker.check(),
              consumer: Effect.all([consumer.check(), publisher.check()]).pipe(
                Effect.map((checks) => checks.every(Boolean))
              ),
              otel: Effect.succeed(!config.otelEndpoint || options.otelHealthy === true),
            },
            { concurrency: 'unbounded' }
          ),
      });
    })
  ).pipe(Layer.provide(Layer.mergeAll(catalog, assets, events, consumers, outbox)));
  return Layer.merge(delivery, availabilityLayer.pipe(Layer.provide(probe))).pipe(
    Layer.provideMerge(tracingLayer)
  );
}
export function createApp(config: Config, options: AppOptions = {}): Promise<FastifyInstance> {
  return createHttpApp(
    { nodeEnv: config.nodeEnv, port: config.port },
    mediaLayer(config, options),
    options
  );
}
