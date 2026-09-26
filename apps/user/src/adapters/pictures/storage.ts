import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { profilePictureAssets } from '../../db/schema.js';
import { Database, databaseDiagnostic } from '../database/index.js';
import { recordDependencyHealth } from '../observations/index.js';
import { Effect, Layer } from 'effect';
import { PictureObjects, PictureUnavailable } from '../../pictures/index.js';

export interface PictureStorageConfig {
  readonly endpoint?: string;
  readonly region: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
}

export function pictureStorageLayer(
  config: PictureStorageConfig
): Layer.Layer<PictureObjects, never, Database> {
  return Layer.effect(
    PictureObjects,
    Effect.gen(function* () {
      const database = yield* Database;
      const client = yield* Effect.acquireRelease(
        Effect.sync(() => {
          if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey) return null;
          return new S3Client({
            endpoint: config.endpoint,
            region: config.region,
            forcePathStyle: true,
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          });
        }),
        (client) => Effect.sync(() => client?.destroy())
      );
      const request = (operation: string, command: PutObjectCommand | DeleteObjectCommand) =>
        Effect.tryPromise({
          try: async (signal) => {
            if (!client) throw new Error('Picture storage is not configured');
            const abortSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
            await client.send(command, { abortSignal });
          },
          catch: (cause) =>
            new PictureUnavailable({
              operation,
              cause: {
                // SDK errors can retain HTTP authorization headers and request bodies.
                // Record their diagnostic identifiers without serializing the response.
                name: cause instanceof Error ? cause.name : 'UnknownStorageFailure',
                ...(cause instanceof S3ServiceException
                  ? { status: cause.$metadata.httpStatusCode, requestId: cause.$metadata.requestId }
                  : {}),
              },
            }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('Picture object operation failed', { operation, cause: error.cause })
          ),
          Effect.withSpan(`pictures.objects.${operation}`),
          Effect.tap(() => recordDependencyHealth('picture-storage', true))
        );
      const address = (id: string) =>
        Effect.tryPromise({
          try: (signal) =>
            database.run(async (db) => {
              const [asset] = await db
                .select({
                  bucket: profilePictureAssets.storageBucket,
                  key: profilePictureAssets.storageKey,
                  mimeType: profilePictureAssets.mimeType,
                })
                .from(profilePictureAssets)
                .where(eq(profilePictureAssets.id, id));
              return asset;
            }, signal),
          catch: (cause) =>
            new PictureUnavailable({
              operation: 'resolve-picture',
              cause: databaseDiagnostic(cause),
            }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('Picture address resolution failed', {
              operation: error.operation,
              cause: error.cause,
            })
          ),
          Effect.withSpan('pictures.objects.resolve-picture')
        );
      return PictureObjects.of({
        put: (assetId, bytes) =>
          Effect.gen(function* () {
            const asset = yield* address(assetId);
            if (!asset)
              return yield* Effect.fail(
                new PictureUnavailable({
                  operation: 'put-picture',
                  cause: { reason: 'missing-candidate' },
                })
              );
            yield* request(
              'put-picture',
              new PutObjectCommand({
                Bucket: asset.bucket,
                Key: asset.key,
                Body: bytes,
                ContentType: asset.mimeType,
                IfNoneMatch: '*',
              })
            );
          }).pipe(Effect.tapError(() => recordDependencyHealth('picture-storage', false))),
        delete: (assetId) =>
          Effect.gen(function* () {
            const asset = yield* address(assetId);
            // Removal of the row is only allowed after successful remote deletion.
            if (!asset) return;
            yield* request(
              'delete-picture',
              new DeleteObjectCommand({ Bucket: asset.bucket, Key: asset.key })
            );
          }).pipe(Effect.tapError(() => recordDependencyHealth('picture-storage', false))),
      });
    })
  );
}
