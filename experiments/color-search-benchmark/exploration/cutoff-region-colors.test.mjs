import assert from 'node:assert/strict';
import test from 'node:test';
import { rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';
import { CUTOFF_LEVELS, CUTOFF_PROFILES, cutoffComponents, cutoffMembership, cutoffWeight } from './cutoff-definition.mjs';
import { cutoffRegionColors } from './cutoff-region-colors.mjs';

const rgbFor = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);

function checkMembership(sample, region, profile, cutoff) {
  const lab = rgbToLab(rgbFor(sample.hex));
  const expected = cutoffMembership(lab, region, { profile, cutoff });
  assert.deepEqual(sample.lab, lab);
  assert.equal(sample.distance, expected.distance);
  assert.equal(sample.quality, expected.referenceQuality);
  assert.equal(sample.referenceQuality, expected.referenceQuality);
  assert.equal(sample.weight, expected.weight);
  assert.equal(sample.matches, expected.weight > 0);
  assert.equal(sample.displayWeight, expected.weight * expected.referenceQuality);
  const components = cutoffComponents(profile, cutoff);
  assert.equal(sample.components.length, components.length);
  for (const [index, component] of components.entries()) {
    const detail = sample.components[index];
    const pixelWeight = cutoffWeight(expected.distance, component.kernel, component.cutoff);
    assert.equal(detail.kernel, component.kernel);
    assert.equal(detail.cutoff, component.cutoff);
    assert.equal(detail.scoreWeight, component.weight);
    assert.equal(detail.pixelWeight, pixelWeight);
    assert.equal(detail.weightedArea, component.weight * pixelWeight);
    assert.equal(detail.matches, pixelWeight > 0);
  }
  assert.equal(sample.weight, sample.components.reduce((sum, component) => sum + component.weightedArea, 0));
}

test('each cutoff/profile has bounded unique RGB8 examples with exact shared membership', () => {
  for (const regionIndex of [0, 4, 7, 631]) {
    for (const { id: profile } of CUTOFF_PROFILES) for (const { cutoff, radius } of CUTOFF_LEVELS) {
      const data = cutoffRegionColors({ regionIndex, profile, cutoff });
      const region = OVERLAP_REGIONS[regionIndex];
      assert.equal(data.definition.profile, profile);
      assert.equal(data.definition.cutoff, cutoff);
      assert.equal(data.definition.radius, radius);
      assert.ok(data.samples.length >= 1 && data.samples.length <= 1024);
      assert.equal(data.samples.length, data.sampling.returnedCount);
      assert.equal(new Set(data.samples.map(sample => sample.hex)).size, data.samples.length);
      const anchors = data.samples.filter(sample => sample.isAnchor);
      assert.equal(anchors.length, 1);
      assert.equal(anchors[0].hex, region.hex);
      assert.equal(anchors[0].quality, 1);
      assert.equal(anchors[0].weight, 1);
      assert.equal(anchors[0].distance, 0);
      for (const sample of data.samples) {
        assert.equal(sample.matches, true);
        checkMembership(sample, region, profile, cutoff);
      }
      assert.match(data.sampling.source, /not pixels measured in a wallpaper/i);
    }
  }
});

test('zero cutoff includes genuinely broader colors while stricter levels preserve near-black anchors', () => {
  const broad = cutoffRegionColors({ regionIndex: 4, cutoff: 0 });
  assert.ok(broad.samples.some(sample => sample.distance > .2));
  assert.ok(broad.samples.some(sample => sample.referenceQuality < .1));
  assert.ok(broad.samples.every(sample => sample.weight === 1));
  const dark = cutoffRegionColors({ regionIndex: 0, cutoff: 0 });
  assert.ok(dark.samples.length > 5);
  assert.ok(dark.samples.some(sample => sample.hex !== '#000000'));
  for (const { id: profile } of CUTOFF_PROFILES) {
    const narrow = cutoffRegionColors({ regionIndex: 0, profile, cutoff: .9 });
    assert.equal(narrow.samples[0].hex, '#000000');
    assert.ok(narrow.samples.every(sample => sample.distance <= .024 + 1e-12));
  }
});

test('context planes retain nonmatches even with positive reference quality and exact RGB8 weights', () => {
  for (const { id: profile } of CUTOFF_PROFILES) {
    const result = cutoffRegionColors({ regionIndex: 4, profile, cutoff: .75 });
    assert.equal(result.contextPlanes.lightness.length, 73 * 21);
    assert.equal(result.contextPlanes.saturation.length, 72 * 21 + 1);
    for (const plane of Object.values(result.contextPlanes)) {
      assert.equal(new Set(plane.map(sample => `${sample.column},${sample.row}`)).size, plane.length);
      assert.ok(plane.some(sample => !sample.matches && sample.quality > 0));
      for (const sample of plane) {
        assert.equal(sample.contextOnly, true);
        assert.equal(sample.isAnchor, false);
        assert.ok(sample.column >= 0 && sample.column <= 72);
        assert.ok(sample.row >= 0 && sample.row <= 20);
        checkMembership(sample, OVERLAP_REGIONS[4], profile, .75);
      }
    }
    const center = result.contextPlanes.lightness.find(sample => sample.row === 10 && sample.column === 36);
    assert.equal(center.hex, '#ff0000');
    assert.equal(center.weight, 1);
    assert.equal(center.quality, 1);
  }
});

test('feather and core-halo expose graded areas; consensus exposes separate weighted cutoff components', () => {
  for (const profile of ['feather', 'core-halo']) {
    const data = cutoffRegionColors({ regionIndex: 4, profile, cutoff: .25 });
    assert.ok(data.samples.some(sample => sample.weight > 0 && sample.weight < 1));
    if (profile === 'core-halo') assert.ok(data.samples.some(sample => !sample.isAnchor && sample.weight === 1));
  }
  const data = cutoffRegionColors({ regionIndex: 4, profile: 'consensus', cutoff: 0 });
  assert.deepEqual(data.definition.components, [{ kernel: 'hard', cutoff: 0, weight: .2 }, { kernel: 'hard', cutoff: .25, weight: .3 }, { kernel: 'hard', cutoff: .5, weight: .5 }]);
  assert.ok(data.samples.some(sample => sample.weight === .2));
  assert.ok(data.samples.some(sample => sample.weight === .5));
  assert.ok(data.samples.some(sample => sample.weight === 1));
  assert.match(data.sampling.consensus, /scores.*separately/i);
  const merged = cutoffRegionColors({ regionIndex: 4, profile: 'consensus', cutoff: .9 });
  assert.equal(merged.samples[0].components.length, 1);
  assert.equal(merged.samples[0].components[0].scoreWeight, 1);
});

test('original region IDs share samples across bucket counts without sharing profile or cutoff results', () => {
  const source = cutoffRegionColors({ regionIndex: 0, profile: 'feather', cutoff: .25 });
  for (const bucketCount of [16, 64, 256, 1024]) {
    const data = cutoffRegionColors({ regionIndex: 0, bucketCount, profile: 'feather', cutoff: .25 });
    assert.strictEqual(data.samples, source.samples);
    assert.strictEqual(data.contextPlanes, source.contextPlanes);
    assert.equal(data.definition.anchorCount, bucketCount);
  }
  assert.notStrictEqual(cutoffRegionColors({ regionIndex: 0, profile: 'hard', cutoff: .25 }).samples, source.samples);
  assert.notStrictEqual(cutoffRegionColors({ regionIndex: 0, profile: 'feather', cutoff: .5 }).samples, source.samples);
});

test('invalid controls and sparse-bank membership fail before creating examples', () => {
  for (const regionIndex of [-1, 1024, .5, '0', null, undefined, NaN]) assert.throws(() => cutoffRegionColors({ regionIndex }), /region index/i);
  for (const bucketCount of [1, 15, 65, '16', null]) assert.throws(() => cutoffRegionColors({ regionIndex: 0, bucketCount }), /bucket count/i);
  for (const cutoff of [-1, .1, 1, '.5', null]) assert.throws(() => cutoffRegionColors({ regionIndex: 0, cutoff }), /cutoff/i);
  for (const profile of ['', 'other', null]) assert.throws(() => cutoffRegionColors({ regionIndex: 0, profile }), /profile/i);
  const missing = OVERLAP_REGIONS.find(region => !overlapRegionsForCount(16).includes(region));
  assert.throws(() => cutoffRegionColors({ regionIndex: missing.index, bucketCount: 16 }), /selected.*bank/i);
});

test('all-level color samples retain broad matches and cache the executed weight distribution', () => {
  const equal = cutoffRegionColors({ regionIndex: 4, profile: 'all-levels', cutoffBlendExponent: 0 });
  const strict = cutoffRegionColors({ regionIndex: 4, profile: 'all-levels', cutoffBlendExponent: 6 });
  assert.notStrictEqual(equal.samples, strict.samples);
  assert.equal(equal.definition.cutoff, 0);
  assert.equal(strict.definition.cutoffBlendExponent, 6);
  assert.equal(equal.definition.components.length, 5);
  assert.deepEqual(equal.definition.components.map(component => component.weight), [.2, .2, .2, .2, .2]);
  const anchor = strict.samples.find(sample => sample.isAnchor);
  assert.ok(Math.abs(anchor.weight - 1) < 1e-12);
  assert.equal(anchor.components.length, 5);
  assert.ok(anchor.components.every(component => component.scoreWeight > 0));
  assert.ok(anchor.components[4].scoreWeight > .65);
  const broad = strict.samples.find(sample => sample.referenceQuality > 0 && sample.referenceQuality < .25);
  assert.ok(broad.matches);
  assert.ok(broad.weight > 0 && broad.weight < .002);
  assert.ok(strict.contextPlanes.lightness.some(sample => !sample.matches));
  const reused = cutoffRegionColors({ regionIndex: 4, bucketCount: 16, profile: 'all-levels', cutoff: .9, cutoffBlendExponent: 6 });
  assert.strictEqual(reused.samples, strict.samples);
  assert.strictEqual(reused.contextPlanes, strict.contextPlanes);
  assert.equal(reused.definition.cutoff, 0);
  for (const sample of strict.samples) {
    const expected = sample.components.reduce((sum, component) => sum + component.scoreWeight * (sample.distance <= .24 * (1 - component.cutoff) + 1e-12 ? 1 : 0), 0);
    assert.ok(Math.abs(sample.weight - expected) < 1e-12);
  }
});
