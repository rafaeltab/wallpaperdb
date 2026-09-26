import { Effect, Layer } from 'effect';
import { initializeOtel } from '../../src/otel-init.js';

const [mode, endpoint] = process.argv.slice(2);
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!endpoint) throw new Error('Missing collector endpoint');

await Effect.runPromise(
  Effect.gen(function* () {
    const status = yield* initializeOtel({
      otelServiceName: 'user-privacy-contract',
      otelEndpoint: endpoint,
    });
    if (status._tag !== 'Started') throw new Error('Telemetry did not start');
    // Match bootstrap ordering: no instrumented adapter loads before the SDK starts.
    const { tracingLayer } = yield* Effect.promise(() => import('../../src/runtime.js'));
    if (mode === 'source') {
      const { pictureSourceLayer } = yield* Effect.promise(
        () => import('../../src/adapters/pictures/index.js')
      );
      const { PictureSource } = yield* Effect.promise(() => import('../../src/pictures/index.js'));
      yield* PictureSource.use((source) =>
        source.download(
          'https://localhost/private-source-path-marker?token=private-source-query-marker'
        )
      ).pipe(
        Effect.ignore,
        Effect.withSpan('privacy.export.control'),
        Effect.provide(
          pictureSourceLayer({ allowedHosts: ['localhost'], maxBytes: 1024, timeoutMs: 200 }).pipe(
            Layer.provideMerge(tracingLayer)
          )
        )
      );
    } else if (mode === 'database' && databaseUrl) {
      const { databaseLayer } = yield* Effect.promise(
        () => import('../../src/adapters/database/index.js')
      );
      const { profileStoreLayer } = yield* Effect.promise(
        () => import('../../src/adapters/profiles/index.js')
      );
      const { ProfileStore } = yield* Effect.promise(() => import('../../src/profile/index.js'));
      const result = yield* ProfileStore.use((store) =>
        store.create({
          profileId: 'privacy-owner',
          displayName: 'Owner',
          handle: 'privacy-owner',
          imageUrl: 'https://img.clerk.com/picture?token=private-database-source-marker',
          now: new Date(),
        })
      ).pipe(
        Effect.match({ onSuccess: () => 'success', onFailure: () => 'unavailable' }),
        Effect.withSpan('privacy.export.control'),
        Effect.provide(
          profileStoreLayer({
            profileHandleMinLength: 1,
            profileHandleMaxLength: 30,
            profileDisplayNameMaxLength: 80,
            profileBiographyMaxLength: 5000,
            profileRetainedAliasLimit: 3,
            profileEvidenceRetentionDays: 30,
            profilePictureMaxBytes: 5242880,
            profilePictureMaxPixels: 16000000,
            profilePictureMaxDecodedBytes: 67108864,
          }).pipe(Layer.provide(databaseLayer({ databaseUrl })), Layer.provideMerge(tracingLayer))
        )
      );
      if (result !== 'unavailable') throw new Error('Database trigger did not reject the write');
    } else throw new Error('Unknown privacy contract');
  }).pipe(Effect.scoped)
);
