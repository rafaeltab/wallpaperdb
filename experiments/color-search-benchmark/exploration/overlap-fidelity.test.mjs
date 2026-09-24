import test from 'node:test';
import assert from 'node:assert/strict';
import { measureRgbaColors, summarizeDistribution, compareOverlapMeasurement } from './overlap-fidelity.mjs';
import { rgbToLab } from './corpus-colors.mjs';

test('independent direct measurement separates literal area from conditional match quality', () => {
  const [red, black] = measureRgbaColors(Buffer.from([255, 0, 0, 255, 255, 0, 0, 0]), [rgbToLab([1, 0, 0]), rgbToLab([0, 0, 0])]);
  assert.deepEqual(red, { pixels: 2, count: 1, area: .5, qualityMass: .5, quality: 1 });
  assert.deepEqual(black, { pixels: 2, count: 1, area: .5, qualityMass: .5, quality: 1 });
});

test('fidelity errors compare actual area and quality mass without normalizing overlapping regions', () => {
  const comparison = compareOverlapMeasurement({ area: .4, qualityMass: .32, quality: .8 }, { coverage: 5000, quality: .75 });
  assert.equal(comparison.storedArea, .5);
  assert.equal(comparison.storedQualityMass, .375);
  assert.ok(Math.abs(comparison.areaAbsoluteError - .1) < 1e-12);
  assert.ok(Math.abs(comparison.qualityMassAbsoluteError - .055) < 1e-12);
  assert.ok(Math.abs(comparison.qualityAbsoluteError - .05) < 1e-12);
});

test('distribution uses nearest-rank percentiles and handles empty active subsets', () => {
  assert.deepEqual(summarizeDistribution([4, 1, 3, 2]), { count: 4, min: 1, mean: 2.5, p50: 2, p95: 4, max: 4 });
  assert.deepEqual(summarizeDistribution([]), { count: 0, min: null, mean: null, p50: null, p95: null, max: null });
});
