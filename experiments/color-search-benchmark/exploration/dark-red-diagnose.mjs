// Read-only diagnosis. Pixel counterfactuals explain measurements; they do not rank wallpapers.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { rgbToLab, rgbToHsv } from './corpus-colors.mjs';
import { cutoffWeight, CUTOFF_LEVELS, cutoffFields, cutoffIndexForCount } from './cutoff-definition.mjs';
import { nearestOverlapRegionForCount } from './overlap-banks.mjs';
import { STORE, hash, api } from './service.mjs';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const filename = option('--image', '/home/rafaeltab/.t3/userdata/attachments/2e3d9373-52f7-4563-8387-0de843690bfe-d63b0812-971c-45c5-b37a-0a5300402a78.webp');
const directory = path.resolve(option('--directory', path.join(STORE, 'dark-red', '2026-09-21')));
const sharp = createRequire(new URL('../../../apps/color-extractor/package.json', import.meta.url))('sharp');
sharp.concurrency(1);
const reference = rgbToLab([1, 0, 0]);
const rgbFor = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
const hexFor = rgb => '#' + rgb.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
function measure(rgb) {
  const lab = rgbToLab(rgb), hsv = rgbToHsv(rgb), delta = lab.map((value, index) => value - reference[index]);
  const lightnessSquared = delta[0] ** 2, chromaticSquared = delta[1] ** 2 + delta[2] ** 2;
  const distance = Math.sqrt(lightnessSquared + chromaticSquared);
  const lightnessQuarterDistance = Math.sqrt(lightnessSquared / 16 + chromaticSquared);
  const shadeDirectionDistance = Math.hypot(...lab.slice(1).map((value, i) => reference[0] * (value / Math.max(lab[0], 1e-9) - reference[i + 1] / reference[0])));
  return { hex: hexFor(rgb), lab, hsv, distance, lightnessSquared, chromaticSquared,
    lightnessShareOfSquaredDistance: distance ? lightnessSquared / distance ** 2 : 0,
    currentQuality: Math.max(0, 1 - distance / .24),
    lightnessQuarterQuality: Math.max(0, 1 - lightnessQuarterDistance / .24),
    lightnessQuarterDistance, shadeDirectionDistance,
  };
}
function summarize(pixels) {
  const measurements = [], groups = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]].map(value => Math.round(value * alpha) / 255);
    const data = measure(rgb), [h, s, v] = data.hsv;
    data.diagnosticRed = Math.min(h, 360 - h) <= 20 && s >= .6 && v >= .1;
    measurements.push(data);
    const key = rgb.map(channel => Math.min(15, Math.floor(channel * 16))).join(',');
    if (!groups.has(key)) groups.set(key, { count: 0, rgb: [0, 0, 0] });
    const group = groups.get(key); group.count++; rgb.forEach((channel, i) => { group.rgb[i] += channel; });
  }
  const red = measurements.filter(pixel => pixel.diagnosticRed);
  const levels = (selected, distanceField, qualityField) => CUTOFF_LEVELS.map(({ cutoff }) => {
    const accepted = selected.filter(pixel => cutoffWeight(pixel[distanceField], 'hard', cutoff));
    return { cutoff, areaOfWholeImage: accepted.length / measurements.length, fractionOfSelectedPixels: selected.length ? accepted.length / selected.length : 0,
      conditionalQuality: accepted.length ? accepted.reduce((sum, pixel) => sum + pixel[qualityField], 0) / accepted.length : 0 };
  });
  return {
    pixels: measurements.length,
    current: levels(measurements, 'distance', 'currentQuality'),
    lightnessQuarter: levels(measurements, 'lightnessQuarterDistance', 'lightnessQuarterQuality'),
    diagnosticRed: { definition: 'Diagnostic mask only, not a human area label: HSV hue within 20 degrees of red, saturation >=60%, value >=10%.',
      area: red.length / measurements.length,
      lightnessShareOfSquaredDistance: red.reduce((sum, pixel) => sum + pixel.lightnessSquared, 0) / red.reduce((sum, pixel) => sum + pixel.distance ** 2, 0),
      current: levels(red, 'distance', 'currentQuality'), lightnessQuarter: levels(red, 'lightnessQuarterDistance', 'lightnessQuarterQuality'),
    },
    prominentColorGroups: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 20).map(group => ({ area: group.count / measurements.length, ...measure(group.rgb.map(value => value / group.count)) })),
  };
}

const bytes = await readFile(filename);
const result = { schemaVersion: 1, at: new Date().toISOString(), image: filename, sha256: hash(bytes), metadata: await sharp(bytes).metadata(), reference: { hex: '#ff0000', lab: reference },
  method: 'Actual current OKLab and hard-cutoff functions; L-only counterfactual scales delta L by0.25 before Euclidean distance. Counterfactuals are offline diagnosis, not search implementations.',
  anchors: [16, 64, 256, 1024].map(bucketCount => ({ bucketCount, ...nearestOverlapRegionForCount(reference, bucketCount) })),
  swatches: ['#ff0000', '#cc0000', '#c00000', '#a00000', '#800000', '#400000', '#000000', '#333333', '#ff8080', '#ff6600', '#804000', '#d04040'].map(hex => measure(rgbFor(hex))),
  resolutions: [],
};
for (const size of [128, 512]) {
  const pixels = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer();
  result.resolutions.push({ size, ...summarize(pixels) });
}
const verifyId = option('--verify-corpus-id');
if (verifyId) {
  const fields = CUTOFF_LEVELS.flatMap(({ cutoff }) => Object.values(cutoffFields(4, 'hard', cutoff)));
  const response = await api(`${cutoffIndexForCount(16)}/_search`, { method: 'POST', body: { size: 1, _source: fields, query: { term: { id: verifyId } } } });
  const source = response.body.hits.hits[0]?._source;
  assert.ok(source, 'Expected the identified corpus document.');
  const comparisons = result.resolutions[0].current.map(level => {
    const names = cutoffFields(4, 'hard', level.cutoff);
    const coverage = Math.round(level.areaOfWholeImage * 10000), quality = Math.fround(level.conditionalQuality);
    assert.equal(source[names.coverage], coverage, 'Pixel probe must reproduce indexed area.');
    assert.equal(source[names.quality], quality, 'Pixel probe must reproduce indexed float32 quality.');
    return { cutoff: level.cutoff, coverage, quality };
  });
  result.sourceParity = { verified: true, id: verifyId, index: cutoffIndexForCount(16), comparisons };
}
await mkdir(directory, { recursive: true });
await copyFile(fileURLToPath(import.meta.url), path.join(directory, 'dark-red-diagnose.mjs'));
const output = path.join(directory, option('--output', 'pixel-diagnosis.json'));
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, sourceParity: result.sourceParity, anchors: result.anchors.map(({ bucketCount, index, hex }) => ({ bucketCount, index, hex })),
  swatches: result.swatches.map(({ hex, currentQuality, lightnessQuarterQuality }) => ({ hex, currentQuality, lightnessQuarterQuality })),
  resolutions: result.resolutions.map(({ size, current, lightnessQuarter, diagnosticRed }) => ({ size, current, lightnessQuarter, diagnosticRed })),
}, null, 2));
