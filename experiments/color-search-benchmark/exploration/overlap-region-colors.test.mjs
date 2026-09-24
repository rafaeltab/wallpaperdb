import assert from 'node:assert/strict';
import test from 'node:test';
import { rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_REGIONS, overlapMembership } from './overlap-regions.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';
import { overlapRegionColors } from './overlap-region-colors.mjs';

test('representative colors are unique displayable RGB8 values with exact membership and anchor', () => {
  for (const regionIndex of [0, 1, 2, 3, 4, 5, 6, 7, 8, 19, 631, 1023]) {
    const result = overlapRegionColors({ regionIndex });
    const region = OVERLAP_REGIONS[regionIndex];
    assert.equal(result.region.index, regionIndex);
    assert.equal(result.region.hex, region.hex);
    assert.equal(result.definition.radius, .12);
    assert.equal(result.definition.edgeWeight, .5);
    assert.equal(result.sampling.kind, 'representative-region-colors');
    assert.match(result.sampling.source, /not pixels measured in a wallpaper/i);
    assert.ok(result.samples.length > 5, `region ${regionIndex} needs a useful range of colors`);
    assert.ok(result.samples.length <= result.sampling.maxSamples);
    assert.equal(result.sampling.returnedCount, result.samples.length);
    assert.equal(new Set(result.samples.map(sample => sample.hex)).size, result.samples.length);
    assert.equal(result.samples.filter(sample => sample.isAnchor).length, 1);
    assert.deepEqual(result.samples.find(sample => sample.isAnchor), { hex: region.hex, lab: region.lab, quality: 1, distance: 0, isAnchor: true });
    for (const sample of result.samples) {
      assert.match(sample.hex, /^#[0-9a-f]{6}$/);
      const lab = rgbToLab([1, 3, 5].map(offset => parseInt(sample.hex.slice(offset, offset + 2), 16) / 255));
      assert.deepEqual(sample.lab, lab);
      const membership = overlapMembership(lab, region);
      assert.equal(membership.area, 1, `${sample.hex} must really match region ${regionIndex}`);
      assert.equal(sample.quality, membership.quality);
      assert.ok(Math.abs(sample.distance - Math.hypot(...lab.map((value, index) => value - region.lab[index]))) < 1e-12);
      assert.ok(sample.quality >= .5 && sample.quality <= 1);
    }
    assert.ok(result.samples.some(sample => sample.quality < .6), `region ${regionIndex} includes edge colors`);
  }
});

test('near-black colors survive local perceptual sampling and do not collapse to black', () => {
  const result = overlapRegionColors({ regionIndex: 0 });
  assert.equal(result.region.hex, '#000000');
  assert.ok(result.samples.some(sample => sample.hex !== '#000000' && sample.lab[0] < .12));
  assert.ok(result.samples.some(sample => sample.lab[1] > .005));
  assert.ok(result.samples.some(sample => sample.lab[1] < -.005));
});

test('reference planes include nonmatching colors with exact displayed RGB8 membership', () => {
  for (const regionIndex of [0, 1, 7, 631]) {
    const result = overlapRegionColors({ regionIndex });
    const region = OVERLAP_REGIONS[regionIndex];
    assert.equal(result.contextPlanes.lightness.length, 73 * 21);
    assert.equal(result.contextPlanes.saturation.length, 72 * 21 + 1);
    for (const axis of ['lightness', 'saturation']) {
      const plane = result.contextPlanes[axis];
      assert.equal(new Set(plane.map(item => `${item.column},${item.row}`)).size, plane.length);
      assert.ok(plane.some(item => !item.matches), `${axis} needs visible nonmatching context`);
      for (const item of plane) {
        assert.ok(item.column >= 0 && item.column <= 72);
        assert.ok(item.row >= 0 && item.row <= 20);
        assert.equal(item.contextOnly, true);
        assert.equal(item.isAnchor, false);
        const lab = rgbToLab([1, 3, 5].map(offset => parseInt(item.hex.slice(offset, offset + 2), 16) / 255));
        const membership = overlapMembership(lab, region);
        assert.deepEqual(item.lab, lab);
        assert.equal(item.quality, membership.quality);
        assert.equal(item.matches, Boolean(membership.area));
        assert.ok(Math.abs(item.distance - Math.hypot(...lab.map((value, index) => value - region.lab[index]))) < 1e-12);
        if (!item.matches) assert.equal(item.quality, 0);
      }
    }
  }
});

test('reference coordinates keep hue-free row endpoints visible across nominal hue columns', () => {
  const redIndex = OVERLAP_REGIONS.find(region => region.hex === '#ff0000').index;
  const { contextPlanes } = overlapRegionColors({ regionIndex: redIndex });
  assert.ok(contextPlanes.lightness.filter(item => item.row === 0).every(item => item.hex === '#000000'));
  assert.ok(contextPlanes.lightness.filter(item => item.row === 20).every(item => item.hex === '#ffffff'));
  assert.ok(contextPlanes.saturation.filter(item => item.row === 0).every(item => item.hex === '#808080'));
  assert.deepEqual(contextPlanes.saturation.filter(item => item.column === 72).map(item => item.row), [0]);
  // The red anchor centers hue at column 36 in both planes.
  for (const [axis, row] of [['lightness', 10], ['saturation', 20]]) {
    const center = contextPlanes[axis].find(item => item.column === 36 && item.row === row);
    assert.equal(center.hex, '#ff0000');
    assert.equal(center.matches, true);
    assert.equal(center.quality, 1);
  }
});

test('shared region geometry is identical across all bucket banks', () => {
  const reference = overlapRegionColors({ regionIndex: 0 });
  for (const bucketCount of [16, 64, 256, 1024]) {
    const result = overlapRegionColors({ regionIndex: 0, bucketCount });
    assert.equal(result.definition.anchorCount, bucketCount);
    assert.strictEqual(result.samples, reference.samples);
    assert.deepEqual(result.region, reference.region);
  }
  const sparseRegion = overlapRegionsForCount(16).find(region => region.index > 16);
  assert.equal(overlapRegionColors({ regionIndex: sparseRegion.index, bucketCount: 16 }).region.index, sparseRegion.index);
});

test('invalid or absent bank members cannot be inspected', () => {
  for (const regionIndex of [-1, 1024, .5, '0', null, undefined, NaN, Infinity]) {
    assert.throws(() => overlapRegionColors({ regionIndex }), /region index/i);
  }
  for (const bucketCount of [1, 15, 65, '16', null]) assert.throws(() => overlapRegionColors({ regionIndex: 0, bucketCount }), /bucket count/i);
  const missing = OVERLAP_REGIONS.find(region => !overlapRegionsForCount(16).includes(region));
  assert.throws(() => overlapRegionColors({ regionIndex: missing.index, bucketCount: 16 }), /selected.*bank/i);
});
