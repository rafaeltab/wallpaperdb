import test from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { cutoffQueryMembership } from './cutoff-blend.mjs';
import { shadeReferenceQuality, shadeMembership, shadeDefinition, shadeIndexForCount } from './shade-definition.mjs';

const lab = hex => rgbToLab([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255));
const red = OVERLAP_REGIONS.find(region => region.hex === '#ff0000');

test('every retained anchor matches itself perfectly, including black and dark colors', () => {
  for (const region of OVERLAP_REGIONS) {
    const result = shadeReferenceQuality(region.lab, region.lab);
    assert.equal(result.referenceQuality, 1, region.hex);
    assert.equal(result.distance, 0, region.hex);
    assert.equal(result.support, true, region.hex);
  }
});

test('neutral anchors retain baseline geometry and cutoff membership exactly', () => {
  for (const hex of ['#000000', '#808080', '#ffffff']) {
    const region = { lab: lab(hex) };
    for (const pixel of ['#000000', '#404040', '#808080', '#ffffff', '#800000', '#ff0000', '#b53738']) {
      for (const cutoff of [0, .25, .5, .75, .9]) {
        const options = { profile: 'hard', cutoff };
        const original = cutoffQueryMembership(lab(pixel), region, options);
        const revised = shadeMembership(lab(pixel), region, options);
        assert.equal(revised.area, original.area);
        assert.equal(revised.referenceQuality, original.referenceQuality);
        assert.equal(revised.quality, original.quality);
      }
    }
  }
});

test('shade tolerance credits saturated and softer reds while retaining visible differences', () => {
  const quality = hex => shadeReferenceQuality(lab(hex), red.lab).referenceQuality;
  assert.ok(quality('#b50000') > .77 && quality('#b50000') < .78);
  assert.ok(quality('#b53738') > .63 && quality('#b53738') < .65);
  assert.ok(quality('#a00000') > .69);
  assert.ok(quality('#800000') > .59 && quality('#800000') < .60);
  assert.ok(quality('#ff6600') > quality('#ff8080'));
  assert.ok(quality('#b50000') > quality('#b53738'));
  assert.ok(quality('#b53738') > quality('#b57070'));
  for (const hex of ['#000000', '#808080', '#202020', '#0000ff', '#800080']) assert.equal(quality(hex), 0, hex);
  assert.ok(quality('#805030') < quality('#b53738'));
});

test('visibility guards suppress almost-black colored pixels and q0 keeps finite support', () => {
  assert.ok(shadeReferenceQuality(lab('#300000'), red.lab).referenceQuality < .4);
  assert.ok(shadeReferenceQuality(lab('#100000'), red.lab).referenceQuality < .1);
  const dark = shadeReferenceQuality(lab('#010000'), red.lab);
  assert.equal(dark.referenceQuality, 0);
  assert.equal(dark.support, false);
  assert.equal(shadeMembership(lab('#010000'), red, { profile: 'hard', cutoff: 0 }).area, 0);
  assert.equal(shadeMembership(lab('#0000ff'), red, { profile: 'hard', cutoff: 0 }).area, 0);
});

test('admission follows adjusted quality and all-level summaries use current blend', () => {
  const pixel = lab('#b53738');
  assert.equal(shadeMembership(pixel, red, { profile: 'hard', cutoff: .5 }).area, 1);
  assert.equal(shadeMembership(pixel, red, { profile: 'hard', cutoff: .75 }).area, 0);
  const equal = shadeMembership(pixel, red, { profile: 'all-levels', cutoffBlendExponent: 0 });
  const strict = shadeMembership(pixel, red, { profile: 'all-levels', cutoffBlendExponent: 6 });
  assert.ok(Math.abs(equal.area - .6) < 1e-12);
  assert.ok(equal.area > strict.area && strict.area > 0);
  assert.ok(Math.abs(equal.quality - strict.quality) < 1e-12);
});

test('definition declares provisional directional metric, bank, and strict input contract', () => {
  for (const count of [16, 64, 256, 1024]) {
    assert.equal(shadeIndexForCount(count), `color-exploration-shade-${count}-real-v1`);
    assert.equal(shadeDefinition({ bucketCount: count, profile: 'all-levels', cutoffBlendExponent: 3 }).anchorCount, count);
  }
  assert.equal(shadeDefinition().metric, 'shade-aware');
  assert.throws(() => shadeIndexForCount(32));
  assert.throws(() => shadeReferenceQuality([NaN, 0, 0], red.lab));
  assert.throws(() => shadeDefinition({ profile: 'feather' }));
});
