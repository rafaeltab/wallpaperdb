import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Effect, Layer } from 'effect';
import { PictureObjects, PictureUnavailable } from '../../pictures/index.js';

export interface PictureStorageConfig {
  readonly endpoint?: string;
  readonly region: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
}

export function pictureStorageLayer(config: PictureStorageConfig): Layer.Layer<PictureObjects> {
  return Layer.effect(
    PictureObjects,
    Effect.gen(function* () {
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
          Effect.withSpan(`pictures.objects.${operation}`)
        );
      return PictureObjects.of({
        put: (asset, bytes) =>
          request(
            'put-picture',
            new PutObjectCommand({
              Bucket: asset.storageBucket,
              Key: asset.storageKey,
              Body: bytes,
              ContentType: asset.mimeType,
              IfNoneMatch: '*',
            })
          ),
        delete: (asset) =>
          request(
            'delete-picture',
            new DeleteObjectCommand({ Bucket: asset.storageBucket, Key: asset.storageKey })
          ),
      });
    })
  );
}
