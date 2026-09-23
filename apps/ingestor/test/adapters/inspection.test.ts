import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import sharp from 'sharp';
import { imageInspectionLayer } from '../../src/adapters/inspection/index.js';
import { ContentInspection, type ValidationLimits } from '../../src/ingestion/index.js';

const limits: ValidationLimits = {
  maxFileSizeImage: 1024 * 1024,
  maxFileSizeVideo: 2 * 1024 * 1024,
  minWidth: 1,
  minHeight: 1,
  maxWidth: 100,
  maxHeight: 100,
  allowedFormats: ['image/jpeg', 'image/png', 'image/webp'],
};

describe('image inspection', () => {
  it.effect('rejects a truncated image signature as invalid content', () =>
    Effect.gen(function* () {
      const inspector = yield* ContentInspection;
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(yield* inspector.inspect(bytes, 'image/png', limits)).toEqual({
        _tag: 'InvalidFormat',
        mimeType: 'image/png',
      });
    }).pipe(Effect.provide(imageInspectionLayer))
  );
  it.effect('rejects corrupt images and formats excluded by policy', () =>
    Effect.gen(function* () {
      const inspector = yield* ContentInspection;
      const bytes = yield* Effect.promise(() =>
        sharp({
          create: {
            width: 12,
            height: 8,
            channels: 3,
            background: '#123456',
          },
        })
          .webp()
          .toBuffer()
      );
      expect(
        yield* inspector.inspect(bytes, 'image/webp', { ...limits, allowedFormats: [] })
      ).toEqual({ _tag: 'InvalidFormat', mimeType: 'image/webp' });
      const corrupt = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
      expect(yield* inspector.inspect(corrupt, 'image/jpeg', limits)).toEqual({
        _tag: 'InvalidFormat',
        mimeType: 'image/jpeg',
      });
    }).pipe(Effect.provide(imageInspectionLayer))
  );
  it.effect('reports dimensions outside the accepted bounds', () =>
    Effect.gen(function* () {
      const bytes = yield* Effect.promise(() =>
        sharp({
          create: {
            width: 12,
            height: 8,
            channels: 3,
            background: '#123456',
          },
        })
          .jpeg()
          .toBuffer()
      );
      const inspector = yield* ContentInspection;
      expect(yield* inspector.inspect(bytes, 'image/jpeg', { ...limits, minWidth: 20 })).toEqual({
        _tag: 'InvalidDimensions',
        width: 12,
        height: 8,
        minWidth: 20,
        minHeight: 1,
        maxWidth: 100,
        maxHeight: 100,
      });
    }).pipe(Effect.provide(imageInspectionLayer))
  );
  it.effect('detects image content independently of the declared MIME type', () =>
    Effect.gen(function* () {
      const bytes = yield* Effect.promise(() =>
        sharp({ create: { width: 12, height: 8, channels: 3, background: '#123456' } })
          .png()
          .toBuffer()
      );
      const inspector = yield* ContentInspection;
      const result = yield* inspector.inspect(bytes, 'image/jpeg', limits);
      expect(result).toMatchObject({
        _tag: 'Inspected',
        metadata: {
          mimeType: 'image/png',
          fileType: 'image',
          width: 12,
          height: 8,
          extension: 'png',
          fileSizeBytes: bytes.length,
          contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      });
    }).pipe(Effect.provide(imageInspectionLayer))
  );
  it.effect('rejects oversized undecodable content before reporting its format', () =>
    ContentInspection.use((inspector) =>
      inspector.inspect(new Uint8Array(101), 'image/png', { ...limits, maxFileSizeImage: 100 })
    ).pipe(
      Effect.tap((result) =>
        Effect.sync(() =>
          expect(result).toEqual({
            _tag: 'TooLarge',
            fileType: 'image',
            fileSizeBytes: 101,
            maxFileSizeBytes: 100,
          })
        )
      ),
      Effect.provide(imageInspectionLayer)
    )
  );
});
