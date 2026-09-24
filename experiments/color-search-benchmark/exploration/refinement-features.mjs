// Extraction-time descriptors only. Live filtering and ranking remain in OpenSearch.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CORPUS_STORE, loadExpandedCorpus } from './service.mjs';

const clamp = (value) => Math.max(0, Math.min(1, value));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const gamma = (channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const linear = Float64Array.from({ length: 256 }, (_, index) => gamma(index / 255));
const quantile = (sorted, fraction) => {
  const position = (sorted.length - 1) * fraction;
  const index = Math.floor(position);
  return sorted[index] + (sorted[Math.min(index + 1, sorted.length - 1)] - sorted[index]) * (position - index);
};

export const RELATIVE_FEATURE_DEFINITION = Object.freeze({
  version: 1,
  source: '512×512 equal-area samples after orientation, conversion to sRGB, and alpha compositing on black.',
  lightness: 'OKLab L on [0,1], computed per sampled pixel before any color quantization.',
  quantiles: 'Linearly interpolated sample quantiles; p999 means the 99.9th percentile.',
  background: 'The global median lightness is a robust background reference. It is not spatial scene segmentation.',
  thresholds: 'Highlight areas count pixels at least 0.10, 0.20, or 0.30 OKLab L above the median. They do not require absolute brightness.',
  adaptiveTail: 'When p99.9 − median >= 0.02, count pixels above median + half that span. Otherwise the adaptive tail area is zero.',
  darkness: 'rel_dark_background = clamp((0.6 − median)/0.6); rel_dark_area50 is the fraction of pixels with L <= 0.5.',
  invariance: 'Relative spans/areas/contrast are invariant under additive lightness shifts without clipping; absolute darkness intentionally is not.',
  limitations: [
    'Global statistics do not identify where bright spots are or distinguish edges from disconnected regions.',
    '512×512 sampling can still lose subpixel highlights. Quantiles reduce the effect of isolated extreme pixels.',
    'The thresholds are generic experimental descriptors, not calibrated human preference boundaries.',
    'A global median can represent a large foreground region rather than the background of a scene.',
  ],
});

export function extractRelativeLightnessFeatures(samples) {
  if (!samples?.length) throw new Error('Require a nonempty lightness sample.');
  const sorted = Float64Array.from(samples);
  let sum = 0;
  for (const value of sorted) {
    if (!Number.isFinite(value)) throw new Error('Every lightness sample must be finite.');
    if (value < 0 || value > 1) throw new Error('Every lightness sample must be between zero and one.');
    sum += value;
  }
  sorted.sort();
  const median = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95), p99 = quantile(sorted, 0.99), p999 = quantile(sorted, 0.999);
  const span = p999 - median;
  let dark = 0, count10 = 0, count20 = 0, count30 = 0, contrast10 = 0, tail = 0;
  for (const value of sorted) {
    const delta = value - median;
    if (value <= 0.5) dark++;
    if (delta >= 0.1 - 1e-12) { count10++; contrast10 += delta; }
    if (delta >= 0.2 - 1e-12) count20++;
    if (delta >= 0.3 - 1e-12) count30++;
    if (span >= 0.02 - 1e-12 && delta >= span / 2 - 1e-12) tail++;
  }
  return {
    rel_pixel_total: sorted.length,
    rel_l_mean: sum / sorted.length,
    rel_l_median: median, rel_l_p95: p95, rel_l_p99: p99, rel_l_p999: p999, rel_l_max: sorted.at(-1),
    rel_span_p99: p99 - median, rel_span_p999: span,
    rel_highlight_10_area: count10 / sorted.length,
    rel_highlight_20_area: count20 / sorted.length,
    rel_highlight_30_area: count30 / sorted.length,
    rel_highlight_10_contrast: count10 ? contrast10 / count10 : 0,
    rel_highlight_tail_area: tail / sorted.length,
    rel_dark_background: clamp((0.6 - median) / 0.6),
    rel_dark_area50: dark / sorted.length,
  };
}

export function extractRelativeRgbaFeatures(rgba) {
  if (!rgba?.length || rgba.length % 4) throw new Error('Require a nonempty RGBA byte sample.');
  const lightness = new Float64Array(rgba.length / 4);
  for (let i = 0; i < lightness.length; i++) {
    const offset = i * 4, alpha = rgba[offset + 3] / 255;
    const r = alpha === 1 ? linear[rgba[offset]] : gamma(rgba[offset] / 255 * alpha);
    const g = alpha === 1 ? linear[rgba[offset + 1]] : gamma(rgba[offset + 1] / 255 * alpha);
    const b = alpha === 1 ? linear[rgba[offset + 2]] : gamma(rgba[offset + 2] / 255 * alpha);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    lightness[i] = clamp(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s);
  }
  return extractRelativeLightnessFeatures(lightness);
}

export async function extractRefinementFeatures({ corpus, store = CORPUS_STORE, size = 512, onProgress = () => {} } = {}) {
  if (!Number.isInteger(size) || size < 128 || size > 1024) throw new Error('Sample size must be an integer from 128 to 1024.');
  corpus ??= await loadExpandedCorpus();
  const sharp = createRequire(new URL('../../../apps/color-extractor/package.json', import.meta.url))('sharp');
  sharp.concurrency(1);
  sharp.cache({ memory: 32, files: 0, items: 10 });
  await mkdir(store, { recursive: true });
  const filename = path.join(store, 'refinement-features.jsonl');
  const manifestFilename = path.join(store, 'refinement-features-manifest.json');
  const temporary = `${filename}.${process.pid}.tmp`;
  const manifestTemporary = `${manifestFilename}.${process.pid}.tmp`;
  const handle = await open(temporary, 'wx');
  const outputHash = createHash('sha256');
  const started = performance.now();
  let count = 0;
  const sources = [];
  try {
    for (const asset of corpus) {
      const bytes = await readFile(asset.filename);
      const sourceHash = hash(bytes);
      if (sourceHash !== asset.sha256) throw new Error(`Source hash changed for ${asset.id}`);
      const pixels = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer();
      const document = { id: asset.id, sha256: sourceHash, rel_sample_width: size, rel_sample_height: size, ...extractRelativeRgbaFeatures(pixels) };
      const line = `${JSON.stringify(document)}\n`;
      await handle.write(line);
      outputHash.update(line);
      sources.push({ id: asset.id, sha256: sourceHash });
      count++;
      if (count % 25 === 0 || count === corpus.length) onProgress({ count, total: corpus.length, elapsedSeconds: (performance.now() - started) / 1000 });
    }
    await handle.close();
    const manifest = {
      schemaVersion: 1, createdAt: new Date().toISOString(), count,
      sampleWidth: size, sampleHeight: size,
      sourceManifestSha256: hash(JSON.stringify(sources)),
      sourceFile: fileURLToPath(import.meta.url), sourceCodeSha256: hash(await readFile(fileURLToPath(import.meta.url))),
      filename, sha256: outputHash.digest('hex'),
      definition: RELATIVE_FEATURE_DEFINITION,
      elapsedSeconds: (performance.now() - started) / 1000,
    };
    await writeFile(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(temporary, filename);
    await rename(manifestTemporary, manifestFilename);
    return manifest;
  } catch (cause) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true });
    await rm(manifestTemporary, { force: true });
    throw cause;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = await extractRefinementFeatures({ onProgress: (progress) => console.log(JSON.stringify(progress)) });
  console.log(JSON.stringify(result, null, 2));
}
