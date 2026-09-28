import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { imageInspectionLayer } from '../src/adapters/inspection/index.js';
import { ContentInspection, Ingestion } from '../src/ingestion/index.js';
import { fixture } from './helpers/ingestion.js';

const inspection = Effect.runSync(ContentInspection.pipe(Effect.provide(imageInspectionLayer)));

async function image(width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg') {
  return sharp({ create: { width, height, channels: 3, background: '#245789' } })
    .toFormat(format)
    .toBuffer();
}

async function upload(bytes: Uint8Array, filename = 'wallpaper.jpg') {
  const test = fixture({ inspection });
  const result = await Effect.runPromise(
    Ingestion.use((ingestion) =>
      ingestion.upload({
        principal: { profileId: 'profile-1' },
        bytes,
        filename,
        declaredMimeType: 'image/jpeg',
      })
    ).pipe(Effect.provide(test.layer))
  );
  return { result, test };
}

describe('wallpaper upload policy', () => {
  it.each([
    ['portrait', 1080, 2400, 'jpeg'],
    ['ultrawide', 10000, 2000, 'webp'],
    ['small', 1, 1, 'png'],
    ['pixel boundary', 10000, 10000, 'jpeg'],
    ['axis boundary', 20000, 1, 'png'],
  ] as const)('accepts %s images', async (_name, width, height, format) => {
    const { result, test } = await upload(await image(width, height, format));
    expect(result).toMatchObject({ _tag: 'Accepted', upload: { width, height } });
    expect(test.objects).toHaveLength(1);
    expect(test.published).toHaveLength(1);
  });

  it.each([
    ['excess pixels', 10001, 10000, 'jpeg', 'TooManyPixels'],
    ['excess width', 20001, 1, 'png', 'InvalidDimensions'],
    ['excess height', 1, 20001, 'png', 'InvalidDimensions'],
  ] as const)('rejects %s before storing or publishing', async (_name, width, height, format, tag) => {
    const { result, test } = await upload(await image(width, height, format));
    expect(result).toMatchObject({ _tag: tag, width, height });
    expect(test.store.records.size).toBe(0);
    expect(test.objects).toEqual([]);
    expect(test.published).toEqual([]);
  });

  it('rejects a file one byte over the byte limit before storing or publishing', async () => {
    const bytes = new Uint8Array(50 * 1024 * 1024 + 1);
    const { result, test } = await upload(bytes);
    expect(result).toMatchObject({ _tag: 'TooLarge', maxFileSizeBytes: 50 * 1024 * 1024 });
    expect(test.store.records.size).toBe(0);
    expect(test.objects).toEqual([]);
    expect(test.published).toEqual([]);
  });

  it.each([
    'png',
    'webp',
  ] as const)('rejects animated %s before storing or publishing', async (format) => {
    const bytes = await readFile(new URL(`./fixtures/animated.${format}`, import.meta.url));
    const { result, test } = await upload(bytes, `animated.${format}`);
    expect(result).toMatchObject({ _tag: 'UnsupportedAnimation' });
    expect(test.store.records.size).toBe(0);
    expect(test.objects).toEqual([]);
    expect(test.published).toEqual([]);
  });
});
