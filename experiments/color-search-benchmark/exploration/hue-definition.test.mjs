import test from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { shadeMembership, shadeReferenceQuality } from './shade-definition.mjs';
import { hueMembership, hueReferenceQuality, hueDefinition, hueIndexForCount } from './hue-definition.mjs';

const lab = hex => rgbToLab([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255));
const red = OVERLAP_REGIONS.find(region => region.hex === '#ff0000');
const polar = degrees => [.5, .15 * Math.cos(degrees * Math.PI / 180), .15 * Math.sin(degrees * Math.PI / 180)];

test('hue refinement preserves every exact anchor and neutral matching', () => {
  for (const region of OVERLAP_REGIONS) {
    const result = hueReferenceQuality(region.lab, region.lab);
    assert.equal(result.referenceQuality, 1, region.hex);
    assert.equal(result.support, true, region.hex);
  }
  for (const hex of ['#000000', '#808080', '#ffffff']) for (const pixel of ['#ff0000', '#ffff00', '#808080', '#000000', '#b53738']) {
    const region = { lab: lab(hex) };
    for (const cutoff of [0, .25, .5, .75, .9]) {
      const options = { profile: 'hard', cutoff };
      const current = shadeMembership(lab(pixel), region, options), next = hueMembership(lab(pixel), region, options);
      assert.equal(next.referenceQuality, current.referenceQuality);
      assert.equal(next.area, current.area);
      assert.equal(next.quality, current.quality);
    }
  }
});

test('circular hue gate has full core, half-valued midpoint, zero edge, and wraps around', () => {
  const center = polar(0);
  assert.equal(hueReferenceQuality(polar(5), center).hueGate, 1);
  assert.ok(Math.abs(hueReferenceQuality(polar(20), center).hueGate - .5) < 1e-12);
  assert.equal(hueReferenceQuality(polar(30), center).hueGate, 0);
  assert.equal(hueReferenceQuality(polar(30), center).support, false);
  assert.equal(hueReferenceQuality(polar(60), center).hueGate, 0);
  assert.ok(Math.abs(hueReferenceQuality(polar(350), polar(10)).hueGapDegrees - 20) < 1e-10);
  assert.equal(hueReferenceQuality(polar(359), polar(1)).hueGate, 1);
});

test('controlled hue refinement matches diagnostic predictions without losing shade credit', () => {
  const quality = hex => hueReferenceQuality(lab(hex), red.lab).referenceQuality;
  assert.ok(Math.abs(quality('#ff6600') - .5648581796252697) < 1e-12);
  assert.ok(Math.abs(quality('#ff8000') - .11112603347280547) < 1e-12);
  assert.ok(quality('#ff6600') > quality('#ff8080'));
  assert.equal(quality('#ffa500'), 0);
  for (const hex of ['#ff2200', '#a00000', '#800000', '#b53738', '#642b2a']) assert.equal(quality(hex), shadeReferenceQuality(lab(hex), red.lab).referenceQuality);
  for (const hex of ['#808080', '#202020', '#000000', '#0000ff']) assert.equal(quality(hex), 0);
  assert.ok(quality('#805030') < .06);
});

test('hue support is a subset and positive cutoff admission uses adjusted quality', () => {
  for (const region of OVERLAP_REGIONS.slice(0, 16)) for (const pixel of ['#ff0000', '#800000', '#ff6600', '#ff8000', '#808080']) {
    const old = shadeReferenceQuality(lab(pixel), region.lab), next = hueReferenceQuality(lab(pixel), region.lab);
    assert.ok(next.referenceQuality <= old.referenceQuality);
    if (next.support) assert.equal(old.support, true);
  }
  assert.equal(hueMembership(lab('#ff8000'), red, { profile: 'hard', cutoff: .25 }).area, 0);
  assert.equal(hueMembership(lab('#ffa500'), red, { profile: 'hard', cutoff: 0 }).area, 0);
  assert.ok(hueMembership(lab('#ff6600'), red, { profile: 'all-levels', cutoffBlendExponent: 0 }).weight > 0);
});

test('versioned hue identity and inputs remain explicit', () => {
  assert.equal(hueDefinition().metric, 'shade-hue-aware');
  for (const count of [16, 64, 256, 1024]) assert.equal(hueIndexForCount(count), `color-exploration-shade-hue-${count}-real-v1`);
  assert.throws(() => hueIndexForCount(32));
  assert.throws(() => hueReferenceQuality([0, NaN, 0], red.lab));
  assert.throws(() => hueDefinition({ profile: 'feather' }));
});
