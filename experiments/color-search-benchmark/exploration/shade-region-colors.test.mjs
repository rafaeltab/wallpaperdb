import assert from 'node:assert/strict';
import test from 'node:test';
import { rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { shadeMembership } from './shade-definition.mjs';
import { shadeRegionColors } from './shade-region-colors.mjs';

const rgbFor = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);

test('shade examples use exact shared RGB8 membership in every displayed layer', () => {
  for (const regionIndex of [0, 4, 631]) for (const cutoff of [0, .5, .9]) {
    const result = shadeRegionColors({ regionIndex, profile: 'hard', cutoff });
    const region = OVERLAP_REGIONS[regionIndex];
    assert.equal(result.definition.metric, 'shade-aware');
    assert.equal(result.definition.profile, 'hard');
    assert.ok(result.samples.length >= 1 && result.samples.length <= 1024);
    if (regionIndex !== 0 || cutoff !== .9) assert.ok(result.samples.length > 1);
    assert.equal(new Set(result.samples.map(sample => sample.hex)).size, result.samples.length);
    const anchors = result.samples.filter(sample => sample.isAnchor);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].hex, region.hex);
    assert.equal(anchors[0].referenceQuality, 1);
    for (const sample of [...result.samples, ...result.contextPlanes.lightness]) {
      const expected = shadeMembership(rgbToLab(rgbFor(sample.hex)), region, { profile: 'hard', cutoff });
      assert.equal(sample.referenceQuality, expected.referenceQuality);
      assert.equal(sample.distance, expected.distance);
      assert.equal(sample.weight, expected.weight);
      assert.equal(sample.matches, expected.weight > 0);
      assert.equal(sample.displayWeight, expected.weight * expected.referenceQuality);
    }
    assert.ok(result.contextPlanes.lightness.some(sample => !sample.matches));
  }
});

test('full-gamut shade sampling includes dark red outside the previous spherical support', () => {
  const result = shadeRegionColors({ regionIndex: 4, profile: 'hard', cutoff: .5 });
  const dark = result.contextPlanes.lightness.find(sample => sample.hex === '#800000');
  assert.ok(dark.matches);
  assert.ok(dark.referenceQuality > .5);
  assert.equal(result.contextPlanes.lightness.length, 73 * 21);
  assert.equal(result.contextPlanes.saturation.length, 72 * 21 + 1);
  assert.match(result.sampling.source, /not pixels measured in a wallpaper/i);
});

test('all five shade layers preserve saved weights and reuse only matching geometry caches', () => {
  const equal = shadeRegionColors({ regionIndex: 4, profile: 'all-levels', cutoffBlendExponent: 0 });
  const strict = shadeRegionColors({ regionIndex: 4, profile: 'all-levels', cutoffBlendExponent: 6 });
  assert.notStrictEqual(equal.samples, strict.samples);
  assert.equal(strict.definition.cutoffBlendExponent, 6);
  for (const sample of strict.samples) {
    assert.equal(sample.components.length, 5);
    assert.ok(sample.components.every(component => component.scoreWeight > 0));
    assert.ok(Math.abs(sample.weight - sample.components.reduce((sum, component) => sum + component.weightedArea, 0)) < 1e-12);
    for (const component of sample.components) assert.equal(component.pixelWeight,
      shadeMembership(sample.lab, OVERLAP_REGIONS[4], { profile: 'hard', cutoff: component.cutoff }).weight);
  }
  for (const bucketCount of [16, 64, 256, 1024]) {
    const reused = shadeRegionColors({ regionIndex: 4, bucketCount, profile: 'all-levels', cutoffBlendExponent: 6 });
    assert.strictEqual(reused.samples, strict.samples);
    assert.equal(reused.definition.anchorCount, bucketCount);
  }
  assert.throws(() => shadeRegionColors({ regionIndex: 8, bucketCount: 16 }), /selected.*bank/i);
  assert.throws(() => shadeRegionColors({ regionIndex: -1 }), /region index/i);
  assert.throws(() => shadeRegionColors({ regionIndex: 4, profile: 'bad' }), /profile/i);
});
