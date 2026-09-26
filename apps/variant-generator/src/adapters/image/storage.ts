import { createHash } from 'node:crypto';
import {
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Effect, Schema } from 'effect';
import { GenerationUnavailable, type GeneratedVariant } from '../../generation/index.js';

const preconditionFailed = Schema.is(
  Schema.Struct({
    $metadata: Schema.Struct({ httpStatusCode: Schema.Literal(412) }),
  })
);
const sourceField = 'variant-source';
const createdField = 'variant-created-at';
type StoredOriginal = { readonly storage: { readonly bucket: string; readonly key: string } };
const sourceIdentity = (input: StoredOriginal) =>
  createHash('sha256')
    .update(JSON.stringify([input.storage.bucket, input.storage.key]))
    .digest('hex');

function storedMetadata(
  stored: HeadObjectCommandOutput,
  input: StoredOriginal,
  candidate: GeneratedVariant
): GeneratedVariant {
  const length = stored.ContentLength;
  if (
    length === undefined ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > 64 * 1024 * 1024 ||
    stored.ContentType !== candidate.format
  ) {
    throw new Error('Existing variant has invalid size or content type');
  }
  const metadata = stored.Metadata ?? {};
  const source = metadata[sourceField];
  const created = metadata[createdField];
  // Pre-migration objects have neither owned field. Their producer-owned target
  // namespace and immutable wallpaper identity establish legacy ownership.
  if (source === undefined && created === undefined) return { ...candidate, fileSizeBytes: length };
  if (
    source !== sourceIdentity(input) ||
    created === undefined ||
    !Number.isFinite(Date.parse(created))
  ) {
    throw new Error('Existing variant has incompatible source or creation metadata');
  }
  return { ...candidate, fileSizeBytes: length, createdAt: new Date(created) };
}

/** The first writer owns the immutable target; a conflicting writer adopts its stored result. */
export function storeVariant(
  client: S3Client,
  input: StoredOriginal,
  candidate: GeneratedVariant,
  bytes: Uint8Array
): Effect.Effect<GeneratedVariant, GenerationUnavailable> {
  return Effect.tryPromise({
    try: async (abortSignal) => {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: candidate.storageBucket,
            Key: candidate.storageKey,
            Body: bytes,
            ContentType: candidate.format,
            IfNoneMatch: '*',
            Metadata: {
              [sourceField]: sourceIdentity(input),
              [createdField]: candidate.createdAt.toISOString(),
            },
          }),
          { abortSignal }
        );
        return candidate;
      } catch (cause) {
        if (!preconditionFailed(cause)) throw cause;
      }
      const stored = await client.send(
        new HeadObjectCommand({ Bucket: candidate.storageBucket, Key: candidate.storageKey }),
        { abortSignal }
      );
      return storedMetadata(stored, input, candidate);
    },
    catch: (cause) => new GenerationUnavailable({ operation: 'write-image', cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Variant storage failed', { operation: error.operation, cause: error.cause })
    )
  );
}
