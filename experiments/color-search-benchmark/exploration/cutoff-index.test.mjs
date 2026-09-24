import test from 'node:test';
import assert from 'node:assert/strict';
import { createCutoffEncoder, toCutoffDocument, cutoffMapping, verifyHard50Parity } from './cutoff-index.mjs';
import { createOverlapEncoder, toOverlapDocument } from './overlap-index.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { cutoffFields, cutoffMembership, CUTOFF_LEVELS, CUTOFF_KERNELS } from './cutoff-definition.mjs';

test('new hard 50% encoder is bit-identical to original coverage and float32 quality', () => {
  const pixels = Uint8Array.from([255,0,0,255, 20,40,60,255, 40,230,100,128, 230,80,210,0, 255,255,255,255]);
  const old = toOverlapDocument({ id: 'sample' }, createOverlapEncoder().encodePixels(pixels));
  const current = createCutoffEncoder().encodePixels(pixels);
  assert.equal(verifyHard50Parity(current, old), true);
  assert.equal(current.pixelCount, 5);
});

test('weighted extraction agrees with explicit per-pixel membership and preserves alpha preprocessing', () => {
  const pixels = Uint8Array.from([255,0,0,255, 230,0,0,255, 255,0,0,128]);
  const descriptor = createCutoffEncoder().encodePixels(pixels);
  const document = toCutoffDocument({ id: 'sample', cov_red: 3000, quality_red: .7 }, descriptor, 16);
  for (const kernel of CUTOFF_KERNELS) for (const level of CUTOFF_LEVELS) {
    const fields = cutoffFields(4, kernel, level.cutoff), region = OVERLAP_REGIONS[4];
    const samples = [[1,0,0],[230/255,0,0],[128/255,0,0]].map(rgb => {
      // Conversion is imported below without approximating RGB8 input.
      return cutoffMembership(rgbToLab(rgb), region, { profile: kernel, cutoff: level.cutoff });
    });
    const mass = samples.reduce((sum, sample) => sum + sample.weight, 0);
    const quality = mass ? Math.fround(samples.reduce((sum, sample) => sum + sample.weight * sample.quality, 0) / mass) : 0;
    assert.equal(document[fields.coverage], Math.round(mass / 3 * 10000));
    assert.equal(document[fields.quality], quality);
  }
  assert.equal(document.cov_red, 3000);
  assert.equal(document.quality_red, .7);
  assert.equal(document.overlap_pixel_total, 3);
});

test('every field is explicit, zero-weight quality is zero, and mappings vary only by retained anchors', () => {
  const descriptor = createCutoffEncoder({ cacheLimit: 0 }).encodePixels(Uint8Array.from([0,0,0,255]));
  for (const count of [16,64,256,1024]) {
    const doc = toCutoffDocument({ id: 'black' }, descriptor, count), mapping = cutoffMapping({ bucketCount: count });
    assert.equal(Object.keys(doc).filter(field => /^cov_o\d/.test(field)).length, count * 15);
    assert.equal(Object.keys(mapping.mappings.properties).filter(field => /^(cov|quality)_o\d/.test(field)).length, count * 30);
    for (const [key, value] of Object.entries(doc)) if (key.startsWith('cov_o') && value === 0) {
      const quality = doc[key.replace('cov_', 'quality_')];
      assert.ok(quality >= 0 && quality <= 1);
    }
  }
  const white = cutoffFields(7, 'feather', .9);
  const doc = toCutoffDocument({ id: 'black' }, descriptor, 16);
  assert.equal(doc[white.coverage], 0);
  assert.equal(doc[white.quality], 0);
});

import { rgbToLab } from './corpus-colors.mjs';
