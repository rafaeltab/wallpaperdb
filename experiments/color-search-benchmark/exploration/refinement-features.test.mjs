import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractRefinementFeatures, extractRelativeLightnessFeatures, extractRelativeRgbaFeatures } from './refinement-features.mjs';

const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);

test('uniform images have zero relative highlights at every brightness', () => {
  for (const lightness of [0, 0.2, 0.5, 1]) {
    const features = extractRelativeLightnessFeatures(new Float64Array(1000).fill(lightness));
    close(features.rel_l_median, lightness);
    close(features.rel_span_p999, 0);
    close(features.rel_highlight_10_area, 0);
    close(features.rel_highlight_tail_area, 0);
  }
});

test('thin dim lines are relative highlights even below an absolute brightness threshold', () => {
  const samples = new Float64Array(10000).fill(0.1);
  samples.fill(0.35, 9950);
  const features = extractRelativeLightnessFeatures(samples);
  assert.ok(features.rel_l_max < 0.5);
  close(features.rel_highlight_10_area, 0.005);
  close(features.rel_highlight_20_area, 0.005);
  close(features.rel_highlight_30_area, 0);
  close(features.rel_highlight_10_contrast, 0.25);
  close(features.rel_span_p999, 0.25);
  close(features.rel_highlight_tail_area, 0.005);
});

test('relative contrast stays invariant under an unclipped uniform lightness shift', () => {
  const samples = new Float64Array(1000).fill(0.15);
  samples.fill(0.3, 800, 950);
  samples.fill(0.5, 950);
  const before = extractRelativeLightnessFeatures(samples);
  const after = extractRelativeLightnessFeatures(samples.map((value) => value + 0.1));
  for (const key of ['rel_span_p99', 'rel_span_p999', 'rel_highlight_10_area', 'rel_highlight_20_area', 'rel_highlight_30_area', 'rel_highlight_10_contrast', 'rel_highlight_tail_area']) close(before[key], after[key]);
  close(after.rel_l_median - before.rel_l_median, 0.1);
  assert.ok(after.rel_dark_background < before.rel_dark_background);
});

test('quantiles are ordered, descriptors finite, and input is left intact', () => {
  const input = new Float64Array([0.4, 0.2, 0.8, 0.6, 0]);
  const before = input.slice();
  const features = extractRelativeLightnessFeatures(input);
  assert.deepEqual(input, before);
  const quantiles = ['rel_l_median', 'rel_l_p95', 'rel_l_p99', 'rel_l_p999', 'rel_l_max'].map((key) => features[key]);
  assert.deepEqual(quantiles, quantiles.toSorted((a, b) => a - b));
  for (const value of Object.values(features)) assert.ok(Number.isFinite(value));
  assert.throws(() => extractRelativeLightnessFeatures([]), /nonempty/);
  assert.throws(() => extractRelativeLightnessFeatures([NaN]), /finite/);
  assert.throws(() => extractRelativeLightnessFeatures([-0.1]), /zero and one/);
});

test('RGBA extraction composites alpha on black and preserves relative bright pixels', () => {
  const pixels = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 100, 100, 100, 255]);
  const features = extractRelativeRgbaFeatures(pixels);
  close(features.rel_l_median, 0);
  close(features.rel_highlight_10_area, 0.25);
  assert.ok(features.rel_l_max > 0.4 && features.rel_l_max < 0.6);
  const transparent = extractRelativeRgbaFeatures(new Uint8Array([255, 255, 255, 0]));
  close(transparent.rel_l_max, 0);
});

test('sidecar extraction verifies all sources and leaves a previous artifact intact on failure', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'relative-color-features-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sharp = createRequire(new URL('../../../apps/color-extractor/package.json', import.meta.url))('sharp');
  const filename = path.join(directory, 'source.png');
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#121212' } }).png().toBuffer();
  await writeFile(filename, bytes);
  const digest = (data) => createHash('sha256').update(data).digest('hex');
  const corpus = [{ id: 'source', filename, sha256: digest(bytes) }];
  const manifest = await extractRefinementFeatures({ corpus, store: directory, size: 128 });
  const original = await readFile(manifest.filename);
  assert.equal(manifest.count, 1);
  assert.equal(digest(original), manifest.sha256);
  assert.equal(JSON.parse(original.toString().trim()).rel_pixel_total, 128 * 128);
  await assert.rejects(() => extractRefinementFeatures({ corpus: [...corpus, { ...corpus[0], id: 'bad-source', sha256: '0'.repeat(64) }], store: directory, size: 128 }), /Source hash changed/);
  assert.deepEqual(await readFile(manifest.filename), original);
  assert.equal((await readdir(directory)).some((entry) => entry.endsWith('.tmp')), false);
});
