import assert from 'node:assert/strict';
import { rgb8ToLab, rgb8ToHsv, deltaE76, preparePixels, measureRelevance, measureMany } from '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/relevance.ts';

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const references = [
  [[255, 0, 0], [53.233, 80.109, 67.220]],
  [[0, 0, 255], [32.303, 79.197, -107.864]],
  [[0, 255, 0], [87.735, -86.183, 83.179]],
  [[255, 255, 255], [100, 0, 0]],
  [[0, 0, 0], [0, 0, 0]],
];
for (const [rgb, expected] of references) {
  const actual = rgb8ToLab(...rgb);
  actual.forEach((value, index) => close(value, expected[index], 0.03));
  console.log(`${rgb.join(',')} -> Lab ${actual.map(value => value.toFixed(5)).join(', ')}`);
}
assert.deepEqual(rgb8ToHsv(255, 0, 0), [0, 1, 1]);
assert.deepEqual(rgb8ToHsv(0, 255, 0), [120, 1, 1]);
assert.deepEqual(rgb8ToHsv(0, 0, 255), [240, 1, 1]);
close(deltaE76([0, 0, 0], [100, 0, 0]), 100);

const red = { color: '#ff0000', amount: 3 };
const blue = { color: '#0000ff', amount: 1 };
const image = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
const prepared = preparePixels(image);
const single = measureRelevance(prepared, [red]);
const pair = measureRelevance(prepared, [red, blue]);
for (const metric of ['lab20', 'lab30', 'lab40', 'hsv']) {
  close(single[metric], 0.75);
  close(pair.perColor[0][metric], 0.75);
  close(pair.perColor[1][metric], 0.25);
  close(pair[metric], 0.75 ** 0.75 * 0.25 ** 0.25);
  close(measureRelevance(image, [{ color: '#00ff00', amount: 1 }])[metric], 0);
  close(measureRelevance(image, [red, { color: '#00ff00', amount: 1 }])[metric], 0);
}
assert.deepEqual(measureMany(prepared, [[red], [red, blue]]), [single, pair]);
const scaled = measureRelevance(prepared, [red, blue].map(entry => ({ ...entry, amount: entry.amount * 9 })));
for (const metric of ['lab20', 'lab30', 'lab40', 'hsv']) close(scaled[metric], pair[metric]);
const alpha = preparePixels(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128, 0, 255, 0, 0]));
assert.equal(alpha.count, 2);
close(measureRelevance(alpha, [red]).lab20, 255 / 383);
const transparent = measureRelevance(new Uint8Array([255, 0, 0, 0]), [red]);
assert.equal(transparent.lab20, 0);
assert.equal(transparent.hsv, 0);
assert.equal(measureRelevance(new Uint8Array(), [red]).lab40, 0);
assert.equal(measureRelevance(new Uint8Array([255, 0, 64, 255]), [red]).hsv, 1);
assert.equal(measureRelevance(new Uint8Array([153, 153, 153, 255]), [{ color: '#808080', amount: 1 }]).hsv, 1);
assert.equal(measureRelevance(new Uint8Array([255, 0, 0, 255]), [{ color: '#808080', amount: 1 }]).hsv, 0);
assert.throws(() => preparePixels(new Uint8Array(3)), /RGBA/);
assert.throws(() => measureRelevance(prepared, []), /At least/);
assert.throws(() => measureRelevance(prepared, [{ color: '#ff0000', amount: 0 }]), /positive/);
assert.throws(() => measureRelevance(prepared, [{ color: 'red', amount: 1 }]), /RRGGBB/);
console.log('PASS: primary conversions, known coverage/proportions, alpha weighting, missing colors, grayscale, hue wrap, amount invariance, reuse and malformed inputs');
