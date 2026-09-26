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
const widthField = 'variant-width';
const heightField = 'variant-height';
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
  const width = metadata[widthField];
  const height = metadata[heightField];
  const legacyDimensions = width === undefined && height === undefined;
  const nominal = {
    width: candidate.target.width,
    height: candidate.target.height,
    aspectRatio: candidate.target.width / candidate.target.height,
  };
  // Metadata-less objects predate source ownership. Their immutable target
  // namespace establishes legacy ownership and preserves nominal public facts.
  if (source === undefined && created === undefined && legacyDimensions) {
    return { ...candidate, ...nominal, fileSizeBytes: length };
  }
  if (
    source !== sourceIdentity(input) ||
    created === undefined ||
    !Number.isFinite(Date.parse(created))
  ) {
    throw new Error('Existing variant has incompatible source or creation metadata');
  }
  if (legacyDimensions) {
    return { ...candidate, ...nominal, fileSizeBytes: length, createdAt: new Date(created) };
  }
  if (
    width === undefined ||
    height === undefined ||
    !/^[1-9]\d*$/.test(width) ||
    !/^[1-9]\d*$/.test(height) ||
    !Number.isSafeInteger(Number(width)) ||
    !Number.isSafeInteger(Number(height)) ||
    Number(width) > candidate.target.width ||
    Number(height) > candidate.target.height
  ) {
    throw new Error('Existing variant has invalid dimension metadata');
  }
  return {
    ...candidate,
    width: Number(width),
    height: Number(height),
    aspectRatio: Number(width) / Number(height),
    fileSizeBytes: length,
    createdAt: new Date(created),
  };
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
              [widthField]: String(candidate.width),
              [heightField]: String(candidate.height),
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
