import { createHash } from 'node:crypto';
import { Effect, Layer } from 'effect';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { ContentInspection, type ValidationLimits } from '../../ingestion/index.js';

class ImageInspection implements ContentInspection {
  readonly inspect = Effect.fn('ingestion.inspect')(function* (
    bytes: Uint8Array,
    declaredMimeType: string,
    limits: ValidationLimits
  ) {
    const detected = yield* Effect.tryPromise({
      try: () => fileTypeFromBuffer(bytes),
      catch: (cause) => cause,
    }).pipe(
      Effect.tapError((cause) => Effect.logDebug('File signature could not be decoded', { cause })),
      Effect.catch(() => Effect.succeed(undefined))
    );
    const mimeType = detected?.mime ?? declaredMimeType;
    const fileType = mimeType.startsWith('image/') ? 'image' : 'video';
    const maxFileSizeBytes =
      fileType === 'image' ? limits.maxFileSizeImage : limits.maxFileSizeVideo;
    if (bytes.byteLength > maxFileSizeBytes)
      return {
        _tag: 'TooLarge',
        fileType,
        fileSizeBytes: bytes.byteLength,
        maxFileSizeBytes,
      } as const;
    if (!detected || !limits.allowedFormats.includes(mimeType) || fileType !== 'image')
      return { _tag: 'InvalidFormat', mimeType } as const;
    const dimensions = yield* Effect.tryPromise({
      try: () => sharp(bytes, { limitInputPixels: 268402689, sequentialRead: true }).metadata(),
      catch: (cause) => cause,
    }).pipe(
      Effect.tapError((cause) => Effect.logDebug('Image metadata could not be decoded', { cause })),
      Effect.catch(() => Effect.succeed(undefined))
    );
    if (!dimensions?.width || !dimensions.height)
      return { _tag: 'InvalidFormat', mimeType } as const;
    if (
      dimensions.width < limits.minWidth ||
      dimensions.height < limits.minHeight ||
      dimensions.width > limits.maxWidth ||
      dimensions.height > limits.maxHeight
    )
      return {
        _tag: 'InvalidDimensions',
        width: dimensions.width,
        height: dimensions.height,
        minWidth: limits.minWidth,
        minHeight: limits.minHeight,
        maxWidth: limits.maxWidth,
        maxHeight: limits.maxHeight,
      } as const;
    return {
      _tag: 'Inspected',
      metadata: {
        mimeType: detected.mime,
        fileType: 'image',
        width: dimensions.width,
        height: dimensions.height,
        fileSizeBytes: bytes.byteLength,
        contentHash: createHash('sha256').update(bytes).digest('hex'),
        extension: detected.ext,
      },
    } as const;
  });
}

export const imageInspectionLayer = Layer.succeed(ContentInspection, new ImageInspection());
