import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadeEncoder, toShadeDocument, shadeMapping } from './shade-index.mjs';
import { shadeMembership } from './shade-definition.mjs';
import { rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';
import { cutoffFields, CUTOFF_LEVELS } from './cutoff-definition.mjs';

test('encoded physical area and conditional mean agree with direct pixel membership at every anchor/layer', () => {
  const rgba = Uint8Array.from([255, 0, 0, 255, 181, 55, 56, 255, 128, 0, 0, 255, 255, 0, 0, 128, 0, 0, 255, 255, 255, 255, 255, 0]);
  const encoder = createShadeEncoder({ cacheLimit: 3 });
  const result = encoder.encodePixels(rgba);
  for (const region of OVERLAP_REGIONS) for (let level = 0; level < CUTOFF_LEVELS.length; level++) {
    const { cutoff } = CUTOFF_LEVELS[level];
    let mass = 0, quality = 0;
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const alpha = rgba[offset + 3] / 255;
      const pixel = rgbToLab([0, 1, 2].map(channel => Math.round(rgba[offset + channel] * alpha) / 255));
      const match = shadeMembership(pixel, region, { profile: 'hard', cutoff });
      mass += match.weight; quality += match.weight * match.quality;
    }
    assert.equal(result.measurements[level].coverage[region.index], Math.round(mass / 6 * 10000));
    assert.equal(result.measurements[level].quality[region.index], mass ? Math.fround(quality / mass) : 0);
  }
  assert.equal(result.pixelCount, 6);
  assert.deepEqual(encoder.encodePixels(rgba), result);
  assert.ok(encoder.stats().cacheEntries <= 3);
});

test('nested projections preserve literal values, metadata and named features', () => {
  const descriptor = createShadeEncoder().encodePixels(Uint8Array.from([181, 55, 56, 255]));
  const feature = { id: 'fixture', cohort: 'controlled', tags: ['red'], cov_red: 10000, quality_red: .8 };
  for (const count of [16, 64, 256, 1024]) {
    const document = toShadeDocument(feature, descriptor, count);
    assert.equal(document.cov_red, feature.cov_red);
    assert.equal(document.quality_red, feature.quality_red);
    assert.equal(document.overlap_pixel_total, 1);
    for (const region of overlapRegionsForCount(count)) for (let i = 0; i < CUTOFF_LEVELS.length; i++) {
      const fields = cutoffFields(region.index, 'hard', CUTOFF_LEVELS[i].cutoff);
      assert.equal(document[fields.coverage], descriptor.measurements[i].coverage[region.index]);
      assert.equal(document[fields.quality], descriptor.measurements[i].quality[region.index]);
    }
    const mapping = shadeMapping({ bucketCount: count });
    assert.equal(mapping.mappings.dynamic, 'strict');
    assert.equal(Object.keys(mapping.mappings.properties).length, count * 10 + 52);
    assert.ok(Object.keys(document).every(field => mapping.mappings.properties[field]));
  }
});

test('encoder and projection reject malformed inputs rather than emitting partial documents', () => {
  assert.throws(() => createShadeEncoder({ cacheLimit: -1 }));
  assert.throws(() => createShadeEncoder().encodePixels(new Uint8Array()));
  assert.throws(() => createShadeEncoder().encodePixels(Uint8Array.from([1, 2, 3])));
  assert.throws(() => toShadeDocument({ id: 'broken' }, { pixelCount: 1, measurements: [] }));
});
