import assert from 'node:assert/strict';
import test from 'node:test';
import { rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { hueMembership } from './hue-definition.mjs';
import { shadeRegionColors, hueRegionColors } from './shade-region-colors.mjs';

const rgbFor = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);

test('strict-hue examples and context colors use exact RGB8 hue-aware membership', () => {
  for (const regionIndex of [0, 4, 631]) for (const cutoff of [0, .5, .9]) {
    const result = hueRegionColors({ regionIndex, profile: 'hard', cutoff });
    const region = OVERLAP_REGIONS[regionIndex];
    assert.equal(result.definition.metric, 'shade-hue-aware');
    assert.ok(result.samples.length >= 1 && result.samples.length <= 1024);
    assert.equal(result.samples.filter(sample => sample.isAnchor).length, 1);
    assert.equal(result.samples.find(sample => sample.isAnchor).referenceQuality, 1);
    for (const sample of [...result.samples, ...result.contextPlanes.lightness]) {
      const expected = hueMembership(rgbToLab(rgbFor(sample.hex)), region, { profile: 'hard', cutoff });
      assert.equal(sample.referenceQuality, expected.referenceQuality);
      assert.equal(sample.distance, expected.distance);
      assert.equal(sample.weight, expected.weight);
      assert.equal(sample.matches, expected.weight > 0);
      assert.equal(sample.hueGapDegrees, expected.hueGapDegrees);
      assert.equal(sample.hueGate, expected.hueGate);
    }
  }
});

test('strict hue preserves dark red but reduces accepted orange and keeps neutral anchors unchanged', () => {
  const shade = shadeRegionColors({ regionIndex: 4, profile: 'hard', cutoff: .5 });
  const hue = hueRegionColors({ regionIndex: 4, profile: 'hard', cutoff: .5 });
  assert.notStrictEqual(shade.samples, hue.samples);
  assert.notStrictEqual(shade.contextPlanes, hue.contextPlanes);
  assert.ok(hue.contextPlanes.lightness.find(sample => sample.hex === '#800000').matches);
  assert.ok(hue.contextPlanes.lightness.filter(sample => sample.matches).length < shade.contextPlanes.lightness.filter(sample => sample.matches).length);
  assert.ok(hue.contextPlanes.lightness.some((sample, index) => !sample.matches && shade.contextPlanes.lightness[index].matches));
  const grayHue = hueRegionColors({ regionIndex: 0, profile: 'hard', cutoff: .5 });
  const grayShade = shadeRegionColors({ regionIndex: 0, profile: 'hard', cutoff: .5 });
  assert.deepEqual(grayHue.samples.map(({hex,weight,referenceQuality})=>({hex,weight,referenceQuality})), grayShade.samples.map(({hex,weight,referenceQuality})=>({hex,weight,referenceQuality})));
});

test('combined strict-hue weights and caches are isolated from shade-only examples across banks', () => {
  const hue = hueRegionColors({ regionIndex: 4, profile: 'all-levels', cutoffBlendExponent: 6 });
  const shade = shadeRegionColors({ regionIndex: 4, profile: 'all-levels', cutoffBlendExponent: 6 });
  assert.notStrictEqual(hue.samples, shade.samples);
  for (const sample of hue.samples) {
    assert.equal(sample.components.length, 5);
    assert.ok(sample.components.every(component => component.scoreWeight > 0));
    for (const component of sample.components) assert.equal(component.pixelWeight,
      hueMembership(sample.lab, OVERLAP_REGIONS[4], {profile:'hard', cutoff:component.cutoff}).weight);
  }
  for (const bucketCount of [16,64,256,1024]) {
    const reused=hueRegionColors({regionIndex:4,bucketCount,profile:'all-levels',cutoffBlendExponent:6});
    assert.strictEqual(reused.samples,hue.samples);
    assert.equal(reused.definition.anchorCount,bucketCount);
  }
});
