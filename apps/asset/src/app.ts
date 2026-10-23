import { Context, Effect, Layer } from 'effect';
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
import { AvailabilityProbe, availabilityLayer } from './capabilities/availability/index.js';
import { CatalogHealth } from './capabilities/catalog/index.js';
import type { Config } from './config.js';
import { deliveryLayer } from './capabilities/delivery/index.js';
import { createHttpApp } from './http/index.js';
import { tracingLayer } from './runtime.js';
import { monitorLayer } from './monitor.js';
import { clerkAuthorLayer, AuthorAuthenticationHealth } from './adapters/authors/index.js';
import { lifecyclePostgresLayer } from './adapters/lifecycle/index.js';
import { lifecycleLayer } from './capabilities/lifecycle/index.js';
import {
  protectedCommandsLayer,
  ProtectedCommandHealth,
  operatorWebhookLayer,
  OperatorNotificationHealth,
} from './adapters/commands/index.js';

import { lifecycleSourceInspectionLayer } from './source-lifecycle.js';
import { sourcesLayer } from './capabilities/sources/index.js';
import {
  sourcePostgresLayer,
  sourceStorageLayer,
  sourceConfirmationsLayer,
  SourceConfirmationHealth,
} from './adapters/sources/index.js';

class AuthorityHealth extends Context.Service<
  AuthorityHealth,
  { readonly check: () => Effect.Effect<boolean>; readonly identity: () => Effect.Effect<boolean> }
>()('asset/composition/AuthorityHealth') {}
function authorityComposition(config: Config) {
  const authority = config.authority;
  if (!authority)
    return {
      operations: Layer.succeed(AuthorityHealth, {
        check: () => Effect.succeed(true),
        identity: () => Effect.succeed(true),
      }),
      authors: undefined,
      sourceAuthors: undefined,
    };
  const persistence = lifecyclePostgresLayer({
    databaseUrl: config.databaseUrl,
    revision: authority.identity,
    ...authority.delivery,
    leaseMs: 30000,
  });
  const lifecycle = lifecycleLayer({
    revision: authority.identity,
    applications: authority.applications,
  }).pipe(Layer.provide(persistence));
  const commandOptions = {
    url: config.natsUrl,
    credential: authority.broker.service,
    applications: authority.applications,
    maxAckPending: authority.broker.maxAckPending,
    ...authority.delivery,
  };
  const commands = protectedCommandsLayer(commandOptions).pipe(
    Layer.provide(Layer.merge(lifecycle, persistence))
  );
  const sourcePersistence = sourcePostgresLayer({
    databaseUrl: config.databaseUrl,
    ...authority.delivery,
    leaseMs: 30000,
  });
  const sourceStorage = sourceStorageLayer({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
    bucket: config.s3Bucket,
  });
  const sources = sourcesLayer({ revision: authority.identity, types: authority.assetTypes }).pipe(
    Layer.provide(Layer.merge(sourcePersistence, sourceStorage))
  );
  const sourcePublisher = sourceConfirmationsLayer(commandOptions).pipe(
    Layer.provide(sourcePersistence)
  );
  const notifications = operatorWebhookLayer({
    ...commandOptions,
    target: authority.operatorNotification,
  });
  const authentication = clerkAuthorLayer(Object.values(authority.identityProviders));
  const operations = Layer.effect(
    AuthorityHealth,
    Effect.gen(function* () {
      const command = yield* ProtectedCommandHealth;
      const notification = yield* OperatorNotificationHealth;
      const identity = yield* AuthorAuthenticationHealth;
      const sourceConfirmation = yield* SourceConfirmationHealth;
      return {
        identity: identity.check,
        check: () =>
          Effect.all([command.check(), notification.check(), sourceConfirmation.check()]).pipe(
            Effect.map((values) => values.every(Boolean))
          ),
      };
    })
  ).pipe(Layer.provide(Layer.mergeAll(commands, notifications, authentication, sourcePublisher)));
  const inspectedLifecycle = lifecycleSourceInspectionLayer.pipe(
    Layer.provide(Layer.merge(lifecycle, sources))
  );
  const authors = Layer.merge(inspectedLifecycle, authentication);
  const sourceAuthors = Layer.merge(sources, authentication);
  return { operations, authors, sourceAuthors };
}

interface AppOptions {
  readonly logger?: boolean;
  readonly signal?: AbortSignal;
  readonly otelHealthy?: boolean;
  readonly shutdownTimeoutMs?: number;
}
export function assetLayer(
  config: Config,
  options: AppOptions = {},
  authority = authorityComposition(config)
) {
  const catalog = CatalogPostgresLayer({
    databaseUrl: config.databaseUrl,
    assetBuckets: { wallpapers: config.s3Bucket, profilePictures: config.profilePictureBucket },
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
          token: config.userAssetServiceToken,
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
      const protectedAuthority = yield* AuthorityHealth;
      return AvailabilityProbe.of({
        inspect: () =>
          Effect.all(
            {
              ...(config.authority ? { identity: protectedAuthority.identity() } : {}),
              database: database.check,
              s3: storage
                .check()
                .pipe(
                  Effect.timeout('5 seconds'),
                  Effect.match({ onSuccess: () => true, onFailure: () => false })
                ),
              nats: broker.check(),
              consumer: Effect.all([
                consumer.check(),
                publisher.check(),
                protectedAuthority.check(),
              ]).pipe(Effect.map((checks) => checks.every(Boolean))),
              otel: Effect.succeed(!config.otelEndpoint || options.otelHealthy === true),
            },
            { concurrency: 'unbounded' }
          ),
      });
    })
  ).pipe(
    Layer.provide(Layer.mergeAll(catalog, assets, events, consumers, outbox, authority.operations))
  );
  const services = Layer.merge(delivery, availabilityLayer.pipe(Layer.provide(probe))).pipe(
    Layer.provideMerge(tracingLayer)
  );
  return monitorLayer({ telemetryEnabled: Boolean(config.otelEndpoint) }).pipe(
    Layer.provideMerge(services)
  );
}
export function createApp(config: Config, options: AppOptions = {}): Promise<FastifyInstance> {
  const authority = authorityComposition(config);
  return createHttpApp(
    { nodeEnv: config.nodeEnv, port: config.port },
    assetLayer(config, options, authority),
    { ...options, authorServices: authority.authors, sourceServices: authority.sourceAuthors }
  );
}
