import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { COLOR_ANCHORS, COLOR_ANCHORS_SHA256, ColorMeasurementsSchema } from '@wallpaperdb/events';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { measurementsFromImage } from '../src/adapters/image/index.js';

const reference = JSON.parse(
  await readFile(new URL('./fixtures/prototype/expected.json', import.meta.url), 'utf8')
);

// Expected values come from executing extractHue and extractSampleFeatures at the
// recorded frozen commit. Named quality uses the reference index's float32 storage.

describe('Sharp image measurements against the frozen prototype', () => {
  it('retains the exact anchor bank, traversal order and original IDs', () => {
    expect(createHash('sha256').update(JSON.stringify(COLOR_ANCHORS)).digest('hex')).toBe(
      reference.anchorSha256
    );
    expect(COLOR_ANCHORS_SHA256).toBe(reference.anchorSha256);
  });

  for (const fixture of reference.cases) {
    it(`matches every coverage and float32 quality for ${fixture.name}`, async () => {
      const bytes = await readFile(
        new URL(`./fixtures/prototype/${fixture.filename}`, import.meta.url)
      );
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
      const actual = await Effect.runPromise(measurementsFromImage(bytes));
      expect(actual.originalSha256).toBe(fixture.sha256);
      expect(actual.measurements).toEqual(ColorMeasurementsSchema.parse(fixture.measurements));
    });
  }

  it('reports a typed decoding failure for invalid bytes', async () => {
    const result = await Effect.runPromise(
      Effect.result(measurementsFromImage(Buffer.from('invalid')))
    );
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'ExtractionUnavailable', operation: 'decode-image' },
    });
  });
});
