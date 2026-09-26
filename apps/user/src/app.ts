import { Effect, Layer } from 'effect';
import type { Config } from './config.js';
import { Database, databaseLayer } from './adapters/database/index.js';
import {
  brokerLayer,
  eventStoreLayer,
  eventPublisherLayer,
  ownershipConsumerLayer,
  EventsHealth,
  ConsumerHealth,
} from './adapters/events/index.js';
import { profileStoreLayer, clerkIdentitiesLayer } from './adapters/profiles/index.js';
import {
  pictureCodecLayer,
  pictureSourceLayer,
  pictureStorageLayer,
  pictureStoreLayer,
} from './adapters/pictures/index.js';
import { Identities, profilesLayer } from './profile/index.js';
import { Pictures, picturesLayer } from './pictures/index.js';
import { Maintenance, maintenanceLayer } from './maintenance/index.js';
import { AvailabilityProbe, availabilityLayer } from './availability/index.js';
import { createHttpApp } from './http/index.js';
import { Workers, workerLayer } from './workers.js';
import { tracingLayer } from './runtime.js';
import { monitorLayer } from './monitor.js';

export interface AppOptions {
  readonly logger?: boolean;
  readonly signal?: AbortSignal;
  readonly shutdownTimeoutMs?: number;
  readonly otelHealthy?: boolean;
  readonly identities?: Identities;
  readonly workers?: boolean;
}
export function userLayer(config: Config, options: AppOptions = {}) {
  const database = databaseLayer({ databaseUrl: config.databaseUrl });
  const profilePolicy = {
    profileHandleMinLength: config.profileHandleMinLength,
    profileHandleMaxLength: config.profileHandleMaxLength,
    profileDisplayNameMaxLength: config.profileDisplayNameMaxLength,
    profileBiographyMaxLength: config.profileBiographyMaxLength,
    profileRetainedAliasLimit: config.profileRetainedAliasLimit,
    profileEvidenceRetentionDays: config.profileEvidenceRetentionDays,
    profilePictureMaxBytes: config.profilePictureMaxBytes,
    profilePictureMaxPixels: config.profilePictureMaxPixels,
    profilePictureMaxDecodedBytes: config.profilePictureMaxDecodedBytes,
  };
  const eventOptions = {
    url: config.natsUrl,
    stream: config.natsStream,
    serviceName: config.otelServiceName,
    shutdownTimeoutMs: options.shutdownTimeoutMs,
  };
  const broker = brokerLayer(eventOptions);
  const profiles = profilesLayer(profilePolicy).pipe(
    Layer.provide(
      Layer.merge(
        profileStoreLayer(profilePolicy).pipe(Layer.provide(database)),
        options.identities
          ? Layer.succeed(Identities, options.identities)
          : clerkIdentitiesLayer({ clerkSecretKey: config.clerkSecretKey })
      )
    )
  );
  const pictures = picturesLayer({
    profileEvidenceRetentionDays: config.profileEvidenceRetentionDays,
    profilePictureImportTimeoutMs: config.profilePictureImportTimeoutMs,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        profiles,
        pictureStoreLayer({ bucket: config.profilePictureBucket }).pipe(Layer.provide(database)),
        pictureCodecLayer({
          maxBytes: config.profilePictureMaxBytes,
          maxPixels: config.profilePictureMaxPixels,
          maxDecodedBytes: config.profilePictureMaxDecodedBytes,
        }),
        pictureSourceLayer({
          maxBytes: config.profilePictureMaxBytes,
          timeoutMs: config.profilePictureImportTimeoutMs,
          allowedHosts: config.profilePictureImportHosts,
        }),
        pictureStorageLayer({
          endpoint: config.s3Endpoint,
          region: config.s3Region,
          accessKeyId: config.s3AccessKeyId,
          secretAccessKey: config.s3SecretAccessKey,
        }).pipe(Layer.provide(database))
      )
    )
  );
  const maintenance = maintenanceLayer({ retentionDays: config.profileEvidenceRetentionDays }).pipe(
    Layer.provide(
      Layer.mergeAll(
        profiles,
        eventStoreLayer().pipe(Layer.provide(database)),
        eventPublisherLayer(eventOptions).pipe(Layer.provide(Layer.merge(database, broker)))
      )
    )
  );
  const consumer = ownershipConsumerLayer(eventOptions).pipe(
    Layer.provide(Layer.merge(maintenance, broker))
  );
  const workers =
    options.workers === false
      ? Layer.succeed(Workers, { check: () => Effect.succeed(true) })
      : Layer.unwrap(
          Effect.gen(function* () {
            const jobs = yield* Maintenance;
            const assets = yield* Pictures;
            return workerLayer(
              [
                {
                  name: 'profile-publication',
                  intervalMs: 1000,
                  run: (stopping) =>
                    jobs.publishPending(stopping).pipe(Effect.map((result) => result.failed === 0)),
                },
                {
                  name: 'alias-expiry',
                  intervalMs: 1000,
                  run: (stopping) =>
                    jobs
                      .expireAliases(new Date(), stopping)
                      .pipe(Effect.map((result) => result.failed === 0)),
                },
                {
                  name: 'picture-import',
                  intervalMs: 1000,
                  run: (stopping) =>
                    assets
                      .importPending(stopping)
                      .pipe(Effect.map((result) => result.failed === 0)),
                },
                {
                  name: 'event-retention',
                  intervalMs: 1000,
                  run: (stopping) =>
                    jobs
                      .cleanupEvents(new Date(), stopping)
                      .pipe(Effect.map((result) => result.failed === 0)),
                },
                {
                  name: 'picture-retention',
                  intervalMs: 1000,
                  run: (stopping) =>
                    assets
                      .cleanupExpired(new Date(), stopping)
                      .pipe(Effect.map((result) => result.failed === 0)),
                },
              ],
              options.shutdownTimeoutMs
            );
          })
        ).pipe(Layer.provide(Layer.merge(maintenance, pictures)));
  const probe = Layer.effect(
    AvailabilityProbe,
    Effect.gen(function* () {
      const db = yield* Database;
      const brokerHealth = yield* EventsHealth;
      const consumerHealth = yield* ConsumerHealth;
      const workerHealth = yield* Workers;
      return AvailabilityProbe.of({
        inspect: () =>
          Effect.all(
            {
              database: db.check,
              nats: brokerHealth.check(),
              workers: Effect.all([consumerHealth.check(), workerHealth.check()]).pipe(
                Effect.map((checks) => checks.every(Boolean))
              ),
              otel: Effect.succeed(!config.otelEndpoint || options.otelHealthy === true),
            },
            { concurrency: 'unbounded' }
          ),
      });
    })
  ).pipe(Layer.provide(Layer.mergeAll(database, broker, consumer, workers)));
  const services = Layer.mergeAll(
    profiles,
    pictures,
    maintenance,
    availabilityLayer.pipe(Layer.provide(probe))
  ).pipe(Layer.provideMerge(database), Layer.provideMerge(tracingLayer));
  return Layer.merge(
    services,
    monitorLayer({ telemetryEnabled: Boolean(config.otelEndpoint) }).pipe(Layer.provide(services))
  );
}
export function createApp(config: Config, options: AppOptions = {}) {
  return createHttpApp(
    {
      nodeEnv: config.nodeEnv,
      port: config.port,
      clerkSecretKey: config.clerkSecretKey,
      profilePictureMaxBytes: config.profilePictureMaxBytes,
      userMediaServiceToken: config.userMediaServiceToken,
    },
    userLayer(config, options),
    options
  );
}
