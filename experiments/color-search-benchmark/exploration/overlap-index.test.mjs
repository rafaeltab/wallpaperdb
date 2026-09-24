import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAP_DEFINITION, OVERLAP_REGIONS, nearestOverlapRegion, regionFields, overlapMembership } from './overlap-regions.mjs';
import { createOverlapEncoder, overlapMapping, toOverlapDocument } from './overlap-index.mjs';
import { rgbToLab, NAMED_COLORS } from './corpus-colors.mjs';

test('1024 deterministic in-gamut anchors retain precise named-color seeds', () => {
  assert.equal(OVERLAP_REGIONS.length, 1024);
  assert.equal(new Set(OVERLAP_REGIONS.map(region => region.hex)).size, 1024);
  for (const region of OVERLAP_REGIONS) {
    assert.ok(region.rgb.every(channel => channel >= 0 && channel <= 1));
    assert.equal(nearestOverlapRegion(region.lab).index, region.index);
    assert.deepEqual(region.lab, rgbToLab(region.rgb));
  }
  for (const hex of Object.values(NAMED_COLORS)) assert.ok(OVERLAP_REGIONS.some(region => region.hex === hex));
  assert.deepEqual(regionFields(0), { coverage: 'cov_o0000', quality: 'quality_o0000' });
});

test('region edge retains full area and half quality; outside contributes neither', () => {
  const center = { lab: [.5, 0, 0] }, radius = OVERLAP_DEFINITION.radius;
  assert.deepEqual(overlapMembership(center.lab, center), { area: 1, quality: 1 });
  assert.deepEqual(overlapMembership([.5 + radius, 0, 0], center), { area: 1, quality: .5 });
  assert.deepEqual(overlapMembership([.5 + radius + .0001, 0, 0], center), { area: 0, quality: 0 });
});

test('coverage is literal sampled area while each pixel enters multiple independent regions', () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const result = createOverlapEncoder().encodePixels(pixels);
  const red = nearestOverlapRegion(rgbToLab([1, 0, 0]));
  const black = nearestOverlapRegion(rgbToLab([0, 0, 0]));
  assert.equal(result.pixelCount, 4);
  assert.equal(result.coverage[red.index], 2500);
  assert.equal(result.quality[red.index], 1);
  assert.equal(result.coverage[black.index], 7500);
  assert.equal(result.quality[black.index], 1);
  assert.ok(result.coverage.reduce((sum, value) => sum + value, 0) > 10000);
  assert.ok(result.coverage.filter(value => value === 2500).length > 1);
  for (let index = 0; index < 1024; index++) {
    const a = overlapMembership(red.lab, OVERLAP_REGIONS[index]);
    const b = overlapMembership(black.lab, OVERLAP_REGIONS[index]);
    assert.equal(result.coverage[index], Math.round((a.area + 3 * b.area) / 4 * 10000));
    const expected = a.area + b.area > 0 ? (a.quality + 3 * b.quality) / (a.area + 3 * b.area) : 0;
    assert.equal(result.quality[index], Math.fround(expected));
  }
});

test('transparent RGB composites to black; cache does not leak previous image state', () => {
  const encoder = createOverlapEncoder({ cacheLimit: 2 });
  encoder.encodePixels(Buffer.from([255, 0, 0, 255]));
  const result = encoder.encodePixels(Buffer.from([255, 0, 0, 0]));
  const black = nearestOverlapRegion(rgbToLab([0, 0, 0]));
  const red = nearestOverlapRegion(rgbToLab([1, 0, 0]));
  assert.equal(result.coverage[black.index], 10000);
  assert.equal(result.quality[black.index], 1);
  assert.equal(result.coverage[red.index], 0);
  assert.throws(() => encoder.encodePixels(Buffer.from([1, 2, 3])), /RGBA/);
});

test('native decay fields are explicit even at zero and mapping supports every field', () => {
  const descriptor = createOverlapEncoder().encodePixels(Buffer.from([0, 0, 0, 255]));
  const document = toOverlapDocument({ id: 'test', cov_red: 0, quality_red: 0 }, descriptor);
  const mapping = overlapMapping({ source: false });
  for (const region of OVERLAP_REGIONS) {
    const fields = regionFields(region.index);
    assert.ok(Object.hasOwn(document, fields.coverage));
    assert.ok(Object.hasOwn(document, fields.quality));
    assert.equal(mapping.mappings.properties[fields.coverage].type, 'integer');
    assert.equal(mapping.mappings.properties[fields.quality].type, 'float');
  }
  assert.equal(document.overlap_pixel_total, 1);
  assert.equal(document.cov_red, 0);
  assert.equal(mapping.mappings._source.enabled, false);
  assert.ok(mapping.settings['index.mapping.total_fields.limit'] >= Object.keys(mapping.mappings.properties).length);
});
