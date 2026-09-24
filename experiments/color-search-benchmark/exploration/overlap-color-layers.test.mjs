import assert from 'node:assert/strict';
import test from 'node:test';
import { colorLayerOptions, colorLayerRequest } from './web/overlap-color-layers.mjs';

const levels = [0, .25, .5, .75, .9];
const layerValue = cutoff => `cutoff-${Math.round(cutoff * 100)}`;
const snapshot = (profile, parameters = {}) => ({
  method: `cutoff-${profile}`,
  definition: { profile, cutoff: profile === 'all-levels' ? 0 : .5 },
  parameters: { bucketCount: 1024, pixelCutoff: profile === 'all-levels' ? 0 : .5,
    ...(profile === 'all-levels' ? { cutoffBlendExponent: 0 } : {}), ...parameters },
});

test('original overlap methods keep their existing request and have no layer selector', () => {
  for (const method of ['overlap-quality-dense', 'overlap-quality-hybrid']) {
    const saved = { method, parameters: { bucketCount: 64 }, definition: { radius: .12 } };
    assert.deepEqual(colorLayerOptions(saved), []);
    assert.deepEqual(colorLayerRequest(saved, 7), { regionIndex: 7, bucketCount: 64 });
    assert.deepEqual(colorLayerRequest(saved, 7, 'current'), { regionIndex: 7, bucketCount: 64 });
    assert.throws(() => colorLayerRequest(saved, 7, 'cutoff-50'), /layer/i);
  }
});

test('all-cutoff combined view preserves the executed weighting in every bucket bank', () => {
  for (const bucketCount of [16, 64, 256, 1024]) {
    const saved = snapshot('all-levels', { bucketCount, cutoffBlendExponent: 4.3 });
    const before = structuredClone(saved);
    const options = colorLayerOptions(saved);
    assert.equal(options[0].value, 'combined');
    assert.match(options[0].label, /4\.3/);
    assert.deepEqual(options.slice(1).map(option => option.value), levels.map(layerValue));
    assert.deepEqual(colorLayerRequest(saved, 5), {
      regionIndex: 5, bucketCount, profile: 'all-levels', cutoff: 0, cutoffBlendExponent: 4.3,
    });
    // These controls affect wallpaper scores, but must not leak into pixel membership.
    saved.parameters.qualityInfluence = 3;
    saved.parameters.minimumQuality = .9;
    assert.deepEqual(colorLayerRequest(saved, 5, 'combined'), {
      regionIndex: 5, bucketCount, profile: 'all-levels', cutoff: 0, cutoffBlendExponent: 4.3,
    });
    delete saved.parameters.qualityInfluence;
    delete saved.parameters.minimumQuality;
    assert.deepEqual(saved, before);
  }
});

test('individual layers are full-strength hard membership even when combined weights are tiny', () => {
  const saved = snapshot('all-levels', { cutoffBlendExponent: 6 });
  const before = structuredClone(saved);
  for (const cutoff of levels) {
    assert.deepEqual(colorLayerRequest(saved, 3, layerValue(cutoff)), {
      regionIndex: 3, bucketCount: 1024, profile: 'hard', cutoff,
    });
  }
  assert.equal(colorLayerRequest(saved, 3, 'combined').cutoffBlendExponent, 6);
  assert.deepEqual(saved, before);
});

test('shade-aware snapshots keep the measured geometry for combined and individual layers', () => {
  for (const bucketCount of [16, 64, 256, 1024]) {
    const saved = snapshot('all-levels', { bucketCount, cutoffBlendExponent: 3.2 });
    saved.method = 'cutoff-shade-all-levels';
    saved.definition.metric = 'shade-aware';
    const before = structuredClone(saved);
    assert.equal(colorLayerOptions(saved)[0].value, 'combined');
    assert.deepEqual(colorLayerRequest(saved, 4), {
      regionIndex: 4, bucketCount, metric: 'shade-aware', profile: 'all-levels', cutoff: 0, cutoffBlendExponent: 3.2,
    });
    for (const cutoff of levels) assert.deepEqual(colorLayerRequest(saved, 4, layerValue(cutoff)), {
      regionIndex: 4, bucketCount, metric: 'shade-aware', profile: 'hard', cutoff,
    });
    assert.deepEqual(saved, before);
    assert.throws(() => colorLayerOptions({ ...saved, definition: { profile: 'all-levels' } }), /metric/i);
    assert.throws(() => colorLayerOptions({ ...saved, method: 'cutoff-all-levels' }), /metric/i);
  }
});

test('strict-hue layers preserve their own metric and never reuse a shade-only snapshot', () => {
  for (const bucketCount of [16, 64, 256, 1024]) {
    const saved = snapshot('all-levels', { bucketCount, cutoffBlendExponent: 2.4 });
    saved.method = 'cutoff-shade-hue-all-levels';
    saved.definition.metric = 'shade-hue-aware';
    const before = structuredClone(saved);
    assert.deepEqual(colorLayerRequest(saved, 4), {
      regionIndex: 4, bucketCount, metric: 'shade-hue-aware', profile: 'all-levels', cutoff: 0, cutoffBlendExponent: 2.4,
    });
    for (const cutoff of levels) assert.deepEqual(colorLayerRequest(saved, 4, layerValue(cutoff)), {
      regionIndex: 4, bucketCount, metric: 'shade-hue-aware', profile: 'hard', cutoff,
    });
    for (const metric of [undefined, 'shade-aware']) assert.throws(() => colorLayerOptions({ ...saved, definition: { ...saved.definition, metric } }), /metric/i);
    assert.throws(() => colorLayerOptions({ ...saved, method: 'cutoff-shade-all-levels' }), /metric/i);
    assert.deepEqual(saved, before);
  }
});

test('legacy consensus exposes all five stored layers, including levels outside its combined window', () => {
  for (const pixelCutoff of [0, .75, .9]) {
    const saved = snapshot('consensus', { pixelCutoff });
    const options = colorLayerOptions(saved);
    assert.equal(options[0].value, 'combined');
    assert.match(options[0].label, new RegExp(`${Math.round(pixelCutoff * 100)}%`));
    assert.deepEqual(options.slice(1).map(option => option.value), levels.map(layerValue));
    assert.deepEqual(colorLayerRequest(saved, 11, 'combined'), {
      regionIndex: 11, bucketCount: 1024, profile: 'consensus', cutoff: pixelCutoff,
    });
    for (const cutoff of levels) assert.deepEqual(colorLayerRequest(saved, 11, layerValue(cutoff)), {
      regionIndex: 11, bucketCount: 1024, profile: 'hard', cutoff,
    });
  }
});

test('single-cutoff layers retain their kernel and current view retains the executed cutoff', () => {
  for (const profile of ['hard', 'feather', 'core-halo']) {
    const saved = snapshot(profile, { pixelCutoff: .25 });
    const options = colorLayerOptions(saved);
    assert.equal(options[0].value, 'current');
    assert.match(options[0].label, /25%/);
    assert.deepEqual(colorLayerRequest(saved, 0), {
      regionIndex: 0, bucketCount: 1024, profile, cutoff: .25,
    });
    for (const cutoff of levels) assert.deepEqual(colorLayerRequest(saved, 0, layerValue(cutoff)), {
      regionIndex: 0, bucketCount: 1024, profile, cutoff,
    });
    assert.throws(() => colorLayerRequest(saved, 0, 'combined'), /layer/i);
  }
});

test('invalid selections and mismatched saved definitions fail instead of displaying a mislabeled layer', () => {
  const saved = snapshot('all-levels');
  for (const selected of ['current', 'cutoff-20', '', null]) {
    assert.throws(() => colorLayerRequest(saved, 0, selected), /layer/i);
  }
  assert.throws(() => colorLayerRequest(saved, -1), /region/i);
  assert.throws(() => colorLayerRequest(saved, 1024), /region/i);
  assert.throws(() => colorLayerRequest(saved, 1.5), /region/i);
  assert.throws(() => colorLayerOptions({ ...saved, definition: { profile: 'feather' } }), /profile/i);
  assert.throws(() => colorLayerOptions(snapshot('all-levels', { cutoffBlendExponent: 7 })), /weight/i);
  assert.throws(() => colorLayerOptions(snapshot('hard', { pixelCutoff: .6 })), /cutoff/i);
  assert.throws(() => colorLayerRequest(snapshot('hard', { bucketCount: 32 }), 0), /bucket/i);
});
