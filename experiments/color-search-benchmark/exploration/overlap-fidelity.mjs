// Offline representation audit. Never used to retrieve or reorder search results.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { NAMED_COLORS, rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_DEFINITION, OVERLAP_REGIONS, nearestOverlapRegion, regionFields } from './overlap-regions.mjs';
import { loadOverlapDocuments, verifyOverlapIndex } from './overlap-index.mjs';
import { loadExpandedCorpus, STORE, hash } from './service.mjs';

export const FIDELITY_COLORS = ['#ff2200', '#4c8c72', '#101010', '#808080', '#dd6600', '#8030b0', '#20b8d0', '#ff0000', '#22cc44', '#aabbcc'];
const sharp = createRequire(new URL('../../../apps/color-extractor/package.json', import.meta.url))('sharp');
sharp.concurrency(1); sharp.cache({ memory: 32, files: 0, items: 20 });
const rgbFromHex = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
const hexFromRgb = rgb => '#' + rgb.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
const distance = (left, right) => Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);

export function summarizeDistribution(values) {
  if (!values.length) return { count: 0, min: null, mean: null, p50: null, p95: null, max: null };
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { count: values.length, min: sorted[0], mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length, p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) };
}

/** Independent brute-force measurement against requested centers, without anchor membership caches. */
export function measureRgbaColors(rgba, centers) {
  if (!rgba.length || rgba.length % 4 !== 0) throw Error('Expected nonempty RGBA pixels');
  const colors = new Map();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3] / 255;
    const rgb = (Math.round(rgba[offset] * alpha) << 16) | (Math.round(rgba[offset + 1] * alpha) << 8) | Math.round(rgba[offset + 2] * alpha);
    colors.set(rgb, (colors.get(rgb) ?? 0) + 1);
  }
  const counts = centers.map(() => 0), masses = centers.map(() => 0), radius = OVERLAP_DEFINITION.radius;
  for (const [rgb, count] of colors) {
    const lab = rgbToLab([(rgb >>> 16) / 255, ((rgb >>> 8) & 255) / 255, (rgb & 255) / 255]);
    for (let index = 0; index < centers.length; index++) {
      const normalized = distance(lab, centers[index]) / radius;
      if (normalized <= 1 + 1e-12) {
        counts[index] += count;
        masses[index] += count * (1 - (1 - OVERLAP_DEFINITION.edgeWeight) * Math.min(1, normalized));
      }
    }
  }
  const pixels = rgba.length / 4;
  return counts.map((count, index) => ({ pixels, count, area: count / pixels, qualityMass: masses[index] / pixels, quality: count ? masses[index] / count : 0 }));
}

export function compareOverlapMeasurement(direct, stored) {
  const storedArea = stored.coverage / 10000, storedQualityMass = storedArea * stored.quality;
  return { directArea: direct.area, storedArea, directQuality: direct.quality, storedQuality: stored.quality, directQualityMass: direct.qualityMass, storedQualityMass,
    areaAbsoluteError: Math.abs(storedArea - direct.area), qualityMassAbsoluteError: Math.abs(storedQualityMass - direct.qualityMass), qualityAbsoluteError: direct.area > 0 && storedArea > 0 ? Math.abs(stored.quality - direct.quality) : null };
}

function anchorMeasurement(color, label) {
  const lab = rgbToLab(rgbFromHex(color)), region = nearestOverlapRegion(lab), absoluteDistance = distance(lab, region.lab);
  return { color, label, regionIndex: region.index, regionHex: region.hex, distance: absoluteDistance, radiusFraction: absoluteDistance / OVERLAP_DEFINITION.radius };
}
function anchorSummary(rows) {
  return { count: rows.length, distance: summarizeDistribution(rows.map(row => row.distance)), radiusFraction: summarizeDistribution(rows.map(row => row.radiusFraction)), exactAnchorFraction: rows.filter(row => row.distance < 1e-12).length / rows.length,
    radiusThresholds: [.05, .1, .2, .25, .5, 1].map(fraction => ({ fraction, coveredFraction: rows.filter(row => row.radiusFraction <= fraction).length / rows.length })), worst: [...rows].sort((left, right) => right.distance - left.distance).slice(0, 10) };
}
function errorSummary(rows) {
  const summarize = subset => ({ comparisons: subset.length, areaAbsoluteError: summarizeDistribution(subset.map(row => row.areaAbsoluteError)), qualityMassAbsoluteError: summarizeDistribution(subset.map(row => row.qualityMassAbsoluteError)), conditionalQualityAbsoluteErrorWhereBothMatch: summarizeDistribution(subset.flatMap(row => row.qualityAbsoluteError == null ? [] : [row.qualityAbsoluteError])) });
  return { all: summarize(rows), active: summarize(rows.filter(row => row.directArea > 0 || row.storedArea > 0)), worstArea: [...rows].sort((left, right) => right.areaAbsoluteError - left.areaAbsoluteError).slice(0, 10), worstQualityMass: [...rows].sort((left, right) => right.qualityMassAbsoluteError - left.qualityMassAbsoluteError).slice(0, 10) };
}

export async function auditOverlapFidelity({ colors = FIDELITY_COLORS } = {}) {
  if (!colors.length || colors.some(color => !/^#[a-f0-9]{6}$/i.test(color))) throw Error('Expected picked RGB hex colors');
  const started = performance.now(), corpus = await loadExpandedCorpus(), documents = new Map((await loadOverlapDocuments()).map(document => [document.id, document]));
  const validation = await verifyOverlapIndex({ expectedIds: corpus.map(asset => asset.id) });
  const grid = [];
  for (let r = 0; r <= 16; r++) for (let g = 0; g <= 16; g++) for (let b = 0; b <= 16; b++) grid.push(anchorMeasurement(hexFromRgb([r / 16, g / 16, b / 16])));
  const named = Object.entries(NAMED_COLORS).map(([name, color]) => anchorMeasurement(color, name));
  const precision = [{ id: 'precision-shade-001', color: '#ff2200' }, { id: 'precision-warm-red-batch-001', color: '#ff2200' }, { id: 'precision-muted-green-batch-001', color: '#4c8c72' }].map(row => anchorMeasurement(row.color, row.id));
  const queries = colors.map(color => ({ ...anchorMeasurement(color), lab: rgbToLab(rgbFromHex(color)) }));
  const centers = queries.flatMap(query => [query.lab, OVERLAP_REGIONS[query.regionIndex].lab]);
  const measurements = [], namedRedComparison = [];
  const namedRedRegion = nearestOverlapRegion(rgbToLab(rgbFromHex(NAMED_COLORS.red))), namedRedField = regionFields(namedRedRegion.index);
  let maximumStoredCoverageDifference = 0, maximumStoredQualityDifference = 0;
  for (const asset of corpus) {
    const bytes = await readFile(asset.filename);
    if (hash(bytes) !== asset.sha256) throw Error(`Fidelity source hash changed: ${asset.id}`);
    const rgba = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().resize(128, 128, { fit: 'fill' }).raw().toBuffer();
    const measured = measureRgbaColors(rgba, centers), document = documents.get(asset.id);
    for (let index = 0; index < queries.length; index++) {
      const query = queries[index], fields = regionFields(query.regionIndex), direct = measured[index * 2], anchor = measured[index * 2 + 1];
      const stored = { coverage: document[fields.coverage], quality: document[fields.quality] };
      const coverageDifference = Math.abs(stored.coverage - Math.round(anchor.area * 10000)), qualityDifference = Math.abs(stored.quality - Math.fround(anchor.quality));
      maximumStoredCoverageDifference = Math.max(maximumStoredCoverageDifference, coverageDifference);
      maximumStoredQualityDifference = Math.max(maximumStoredQualityDifference, qualityDifference);
      if (coverageDifference !== 0 || qualityDifference > 1e-7) throw Error(`Independent descriptor parity failed for ${asset.id} ${query.color}`);
      measurements.push({ id: asset.id, cohort: asset.cohort, color: query.color, regionIndex: query.regionIndex, regionHex: query.regionHex, ...compareOverlapMeasurement(direct, stored) });
    }
    namedRedComparison.push({ id: asset.id, cohort: asset.cohort, broadArea: document.cov_red / 10000, denseArea: document[namedRedField.coverage] / 10000, broadQuality: document.quality_red, denseQuality: document[namedRedField.quality] });
    if (measurements.length % (25 * queries.length) === 0) console.error(`Overlap fidelity ${measurements.length / queries.length}/${corpus.length} (${Math.round((performance.now() - started) / 1000)}s)`);
  }
  const createdAt = new Date().toISOString(), directory = path.join(STORE, 'overlap', 'fidelity', createdAt.replace(/:/g, '-'));
  await mkdir(path.join(directory, 'sources'), { recursive: true });
  const sourceFiles = ['overlap-fidelity.mjs', 'overlap-regions.mjs', 'overlap-index.mjs', 'corpus-colors.mjs'];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async name => {
    const file = fileURLToPath(new URL(name, import.meta.url));
    await copyFile(file, path.join(directory, 'sources', name));
    return [name, hash(await readFile(file))];
  })));
  const result = { schemaVersion: 1, createdAt, durationMs: performance.now() - started, validation, sourceHashes, methodology: {
    type: 'Offline representation fidelity, not human relevance or query throughput', radius: OVERLAP_DEFINITION.radius, edgeWeight: OVERLAP_DEFINITION.edgeWeight, sample: 'Same original-image 128x128 rotated sRGB sample and alpha-on-black preprocessing as indexed descriptors.',
    direct: 'For each actual requested color, brute-force pixel membership and conditional quality at its exact OKLab center.',
    approximation: 'Stored coverage/quality for the nearest anchor, including basis-point area and float32 quality quantization.',
    units: 'Area and quality-mass errors are fractions of whole-image area; multiply by100 for percentage points.',
    coverage: '4913 grid colors test the finite RGB8-rounded17³candidate grid only, not every RGB24 color. Named aliases are retained. Three judged precisioncases contain only two distinct pickedcolors.',
    boundary: 'Small center displacement can change a large uniform region from just inside to just outside the binary radius. Distance/radius alone does not bound image area error.',
  }, anchorCoverage: { grid: anchorSummary(grid), named: { ...anchorSummary(named), rows: named }, precision: { ...anchorSummary(precision), rows: precision }, pickedAuditColors: queries },
    independentStoredDescriptorCheck: { images: corpus.length, comparisons: measurements.length, maximumStoredCoverageDifferenceBasisPoints: maximumStoredCoverageDifference, maximumStoredQualityDifference },
    summary: errorSummary(measurements), realPhotos: errorSummary(measurements.filter(row => row.cohort !== 'controlled-fixture')), perColor: queries.map(query => ({ ...query, ...errorSummary(measurements.filter(row => row.color === query.color)) })),
    namedRedDefinitionComparison: { explanation: 'Broad named red uses the existing hue/saturation/value/chroma heuristic; dense red uses a radius0.12OKLab sphere around#ef2020. Their different areas are different query semantics, not an extraction error or a human relevance judgment.', region: namedRedRegion, broadArea: summarizeDistribution(namedRedComparison.map(row => row.broadArea)), denseArea: summarizeDistribution(namedRedComparison.map(row => row.denseArea)), absoluteAreaDifference: summarizeDistribution(namedRedComparison.map(row => Math.abs(row.broadArea - row.denseArea))), examples: [...namedRedComparison].sort((left, right) => Math.abs(right.broadArea - right.denseArea) - Math.abs(left.broadArea - left.denseArea)).slice(0, 10) }, measurements };
  const filename = path.join(directory, 'fidelity.json');
  await writeFile(filename, JSON.stringify(result, null, 2));
  await writeFile(path.join(STORE, 'overlap', 'fidelity', 'latest.json'), JSON.stringify({ filename, createdAt, summary: result.summary.all, realPhotos: result.realPhotos.all, anchorCoverage: { grid: result.anchorCoverage.grid, precision: result.anchorCoverage.precision }, independentStoredDescriptorCheck: result.independentStoredDescriptorCheck }, null, 2));
  return { filename, ...result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await auditOverlapFidelity();
  console.log(JSON.stringify({ filename: result.filename, durationMs: result.durationMs, anchorCoverage: result.anchorCoverage, summary: result.summary.all, realPhotos: result.realPhotos.all, independentStoredDescriptorCheck: result.independentStoredDescriptorCheck }, null, 2));
}
