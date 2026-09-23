import {
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DateTime, Effect, Layer } from 'effect';
import { AssetStorage, type AssetReference, IngestionUnavailable } from '../../ingestion/index.js';

export interface AssetsConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

const key = (reference: AssetReference) =>
  `${reference.wallpaperId}/original.${reference.extension}`;
const request = <A>(operation: string, send: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: send,
    catch: (cause) => new IngestionUnavailable({ operation, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Asset storage operation failed', {
        operation,
        cause: error.cause,
      })
    )
  );

class S3Assets implements AssetStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string
  ) {}

  readonly put = Effect.fn('ingestion.assets.put')(function* (
    this: S3Assets,
    input: Parameters<AssetStorage['put']>[0]
  ) {
    const now = yield* DateTime.now;
    yield* request('store-asset', (abortSignal) =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key({ wallpaperId: input.wallpaperId, extension: input.metadata.extension }),
          Body: input.bytes,
          ContentType: input.metadata.mimeType,
          Metadata: { userId: input.profileId, uploadedAt: DateTime.formatIso(now) },
        }),
        { abortSignal }
      )
    );
  });

  readonly exists = Effect.fn('ingestion.assets.exists')((reference: AssetReference) =>
    Effect.tryPromise({
      try: (abortSignal) =>
        this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket,
            Key: key(reference),
          }),
          { abortSignal }
        ),
      catch: (cause) => cause,
    }).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        missing(cause)
          ? Effect.succeed(false)
          : Effect.fail(new IngestionUnavailable({ operation: 'inspect-asset', cause }))
      ),
      Effect.tapError((error) => Effect.logError('Asset inspection failed', { cause: error.cause }))
    )
  );

  readonly remove = Effect.fn('ingestion.assets.remove')((reference: AssetReference) =>
    request('remove-asset', (abortSignal) =>
      this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key(reference),
        }),
        { abortSignal }
      )
    ).pipe(Effect.asVoid)
  );

  readonly list = Effect.fn('ingestion.assets.list')(function* (this: S3Assets, cursor?: string) {
    const page = yield* request('list-assets', (abortSignal) =>
      this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: 'wlpr_',
          MaxKeys: 100,
          ContinuationToken: cursor,
        }),
        { abortSignal }
      )
    );
    const assets: AssetReference[] = [];
    for (const object of page.Contents ?? []) {
      const match = /^([^/]+)\/original\.([a-z0-9]+)$/.exec(object.Key ?? '');
      if (match?.[1] && match[2]) assets.push({ wallpaperId: match[1], extension: match[2] });
    }
    return {
      assets,
      ...(page.NextContinuationToken ? { cursor: page.NextContinuationToken } : {}),
    };
  });
}

function missing(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    (cause.name === 'NotFound' || cause.name === 'NoSuchKey')
  );
}

/** Shared client lifetime; every request forwards cancellation to the SDK and has no implicit retries. */
export function assetsLayer(config: AssetsConfig): Layer.Layer<AssetStorage, IngestionUnavailable> {
  return Layer.effect(
    AssetStorage,
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new S3Client({
              endpoint: config.endpoint,
              region: config.region,
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              },
              forcePathStyle: true,
              maxAttempts: 1,
              requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
            })
        ),
        (client) => Effect.sync(() => client.destroy())
      );
      yield* request('connect-assets', (abortSignal) =>
        client.send(new HeadBucketCommand({ Bucket: config.bucket }), { abortSignal })
      );
      return new S3Assets(client, config.bucket);
    })
  );
}
