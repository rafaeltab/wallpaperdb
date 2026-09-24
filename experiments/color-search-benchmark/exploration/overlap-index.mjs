// THROWAWAY PROTOTYPE. Offline extraction; OpenSearch owns query-time ranking.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { FEATURE_NAMES, rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_DEFINITION, OVERLAP_REGIONS, regionFields } from './overlap-regions.mjs';
import { api, bulkIndex, finishIndex, safeIndexName, loadExpandedCorpus, loadFeatures, STORE, CORPUS_STORE, hash } from './service.mjs';

export const OVERLAP_INDEX = 'color-exploration-overlap-real-v1';
export const OVERLAP_STORE = path.join(STORE, 'overlap');
export const OVERLAP_SOURCE_FILES = ['overlap-regions.mjs', 'overlap-index.mjs', 'corpus-colors.mjs'];
const sharp = createRequire(new URL('../../../apps/color-extractor/package.json', import.meta.url))('sharp');
sharp.concurrency(1); sharp.cache({ memory: 32, files: 0, items: 20 });
const fields = OVERLAP_REGIONS.map(region => regionFields(region.index));
const radius = OVERLAP_DEFINITION.radius;
const cellKey = (l, a, b) => `${l},${a},${b}`;
const cells = new Map();
for (const region of OVERLAP_REGIONS) {
  const key = cellKey(...region.lab.map(channel => Math.floor(channel / radius)));
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(region.index);
}

export function createOverlapEncoder({ cacheLimit = 65536 } = {}) {
  if (!Number.isSafeInteger(cacheLimit) || cacheLimit < 0) throw Error('Invalid overlap cache limit');
  const cache = new Map();
  let documents = 0, cacheHits = 0, rgbCalculations = 0, distanceCalculations = 0;
  function contributions(rgb) {
    const cached = cache.get(rgb);
    if (cached) { cacheHits++; return cached; }
    rgbCalculations++;
    const lab = rgbToLab([(rgb >>> 16) / 255, ((rgb >>> 8) & 255) / 255, (rgb & 255) / 255]);
    const cell = lab.map(channel => Math.floor(channel / radius)), indexes = [], weights = [];
    for (let l = cell[0] - 1; l <= cell[0] + 1; l++) for (let a = cell[1] - 1; a <= cell[1] + 1; a++) for (let b = cell[2] - 1; b <= cell[2] + 1; b++) {
      const nearby = cells.get(cellKey(l, a, b));
      if (!nearby) continue;
      for (const index of nearby) {
        const center = OVERLAP_REGIONS[index].lab;
        const dl = lab[0] - center[0], da = lab[1] - center[1], db = lab[2] - center[2];
        distanceCalculations++;
        const normalized = Math.sqrt(dl * dl + da * da + db * db) / radius;
        if (normalized <= 1 + 1e-12) { indexes.push(index); weights.push(1 - .5 * Math.min(1, normalized)); }
      }
    }
    const result = { indexes: Uint16Array.from(indexes), weights: Float64Array.from(weights) };
    if (cacheLimit) {
      if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value);
      cache.set(rgb, result);
    }
    return result;
  }
  return {
    encodePixels(rgba) {
      if (!rgba || rgba.length === 0 || rgba.length % 4 !== 0) throw Error('Expected nonempty RGBA pixels');
      const colors = new Map(), pixelCount = rgba.length / 4;
      for (let offset = 0; offset < rgba.length; offset += 4) {
        const alpha = rgba[offset + 3] / 255;
        const rgb = (Math.round(rgba[offset] * alpha) << 16) | (Math.round(rgba[offset + 1] * alpha) << 8) | Math.round(rgba[offset + 2] * alpha);
        colors.set(rgb, (colors.get(rgb) ?? 0) + 1);
      }
      const counts = new Float64Array(1024), masses = new Float64Array(1024);
      let totalMembership = 0;
      for (const [rgb, count] of colors) {
        const { indexes, weights } = contributions(rgb);
        totalMembership += count * indexes.length;
        for (let offset = 0; offset < indexes.length; offset++) { counts[indexes[offset]] += count; masses[indexes[offset]] += count * weights[offset]; }
      }
      documents++;
      return { pixelCount, coverage: Array.from(counts, count => Math.round(count / pixelCount * 10000)), quality: Array.from(masses, (mass, index) => counts[index] ? Math.fround(mass / counts[index]) : 0), occupiedRegions: counts.reduce((sum, count) => sum + (count > 0 ? 1 : 0), 0), totalMembership };
    },
    stats() { return { documents, cacheHits, rgbCalculations, distanceCalculations, cacheEntries: cache.size, cacheLimit }; },
  };
}

export async function extractOverlap(input, { encoder = createOverlapEncoder() } = {}) {
  const bytes = typeof input === 'string' ? await readFile(input) : input;
  const pixels = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().resize(128, 128, { fit: 'fill' }).raw().toBuffer();
  return encoder.encodePixels(pixels);
}

export function toOverlapDocument(feature, descriptor) {
  if (!feature.id || descriptor.coverage?.length !== 1024 || descriptor.quality?.length !== 1024) throw Error('Expected ID and complete overlap descriptor');
  const document = { id: feature.id, reference_id: feature.reference_id ?? feature.id, cohort: feature.cohort ?? 'real', partition: feature.partition ?? 0, tags: feature.tags ?? [], overlap_pixel_total: descriptor.pixelCount };
  for (const name of FEATURE_NAMES) {
    if (feature['cov_' + name] != null) document['cov_' + name] = feature['cov_' + name];
    if (feature['quality_' + name] != null) document['quality_' + name] = feature['quality_' + name];
  }
  for (let index = 0; index < fields.length; index++) {
    // Native decay defaults missing fields to the origin. Explicit zero is required.
    document[fields[index].coverage] = descriptor.coverage[index];
    document[fields[index].quality] = descriptor.quality[index];
  }
  return document;
}

export function overlapMapping({ source = true, shards = 1 } = {}) {
  const properties = { id: { type: 'keyword' }, reference_id: { type: 'keyword' }, cohort: { type: 'keyword' }, partition: { type: 'integer' }, tags: { type: 'keyword' }, overlap_pixel_total: { type: 'integer' } };
  for (const name of FEATURE_NAMES) { properties['cov_' + name] = { type: 'integer' }; properties['quality_' + name] = { type: 'float' }; }
  for (const field of fields) { properties[field.coverage] = { type: 'integer' }; properties[field.quality] = { type: 'float' }; }
  return { settings: { number_of_shards: shards, number_of_replicas: 0, refresh_interval: '-1', 'index.mapping.total_fields.limit': 2500 }, mappings: { dynamic: 'strict', _source: { enabled: source }, properties } };
}

export async function overlapFingerprints() {
  const corpus = await loadExpandedCorpus();
  const sourceHashes = Object.fromEntries(await Promise.all(OVERLAP_SOURCE_FILES.map(async name => [name, hash(await readFile(new URL(name, import.meta.url)))])));
  const result = { definitionHash: hash(OVERLAP_DEFINITION), computationHash: hash({ definition: OVERLAP_DEFINITION, regions: OVERLAP_REGIONS, sourceHashes }), corpusHash: hash(corpus.map(asset => ({ id: asset.id, sha256: asset.sha256 }))), featureHash: hash(await readFile(path.join(CORPUS_STORE, 'features.jsonl'))), sourceHashes };
  return { ...result, preparationHash: hash(result) };
}
function assertFingerprints(actual, expected) {
  for (const field of ['definitionHash', 'computationHash', 'corpusHash', 'featureHash', 'preparationHash']) if (!expected[field] || actual?.[field] !== expected[field]) throw Error(`Overlap ${field} fingerprint mismatch`);
}
async function loadStored() {
  const fingerprints = await overlapFingerprints();
  const directory = path.join(OVERLAP_STORE, fingerprints.preparationHash.slice(0, 20));
  const metadata = JSON.parse(await readFile(path.join(directory, 'metadata.json'), 'utf8'));
  assertFingerprints(metadata, fingerprints);
  const bytes = await readFile(path.join(directory, 'documents.jsonl'));
  if (hash(bytes) !== metadata.descriptorHash) throw Error('Overlap descriptorHash fingerprint mismatch');
  const documents = bytes.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (documents.length !== metadata.count || new Set(documents.map(document => document.id)).size !== documents.length) throw Error('Overlap stored document cardinality mismatch');
  return { documents, metadata, directory };
}
export async function loadOverlapDocuments() { return (await loadStored()).documents; }

async function prepareDocuments() {
  try { return await loadStored(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const fingerprints = await overlapFingerprints(), corpus = await loadExpandedCorpus(), features = await loadFeatures();
  const byId = new Map(features.map(feature => [feature.id, feature]));
  if (byId.size !== corpus.length || features.length !== corpus.length || corpus.some(asset => !byId.has(asset.id))) throw Error('Overlap corpus/feature IDs differ');
  const directory = path.join(OVERLAP_STORE, fingerprints.preparationHash.slice(0, 20));
  await mkdir(path.join(directory, 'sources'), { recursive: true });
  for (const name of OVERLAP_SOURCE_FILES) await copyFile(fileURLToPath(new URL(name, import.meta.url)), path.join(directory, 'sources', name));
  const encoder = createOverlapEncoder(), documents = [], descriptors = [], started = performance.now();
  for (const asset of corpus) {
    const bytes = await readFile(asset.filename);
    if (hash(bytes) !== asset.sha256) throw Error(`Source image hash changed: ${asset.id}`);
    const descriptor = await extractOverlap(bytes, { encoder });
    descriptors.push({ id: asset.id, ...descriptor });
    documents.push(toOverlapDocument({ ...asset, ...byId.get(asset.id) }, descriptor));
    if (documents.length % 25 === 0) console.error(`Overlap extraction ${documents.length}/${corpus.length} (${Math.round((performance.now() - started) / 1000)}s)`);
  }
  const data = documents.map(document => JSON.stringify(document)).join('\n') + '\n';
  await writeFile(path.join(directory, 'documents.jsonl'), data);
  await writeFile(path.join(directory, 'descriptors.jsonl'), descriptors.map(descriptor => JSON.stringify(descriptor)).join('\n') + '\n');
  const metadata = { schemaVersion: 1, ...fingerprints, definition: OVERLAP_DEFINITION, descriptorHash: hash(data), count: documents.length, createdAt: new Date().toISOString(), extractionMs: performance.now() - started, sourceDirectory: path.join(directory, 'sources'), descriptorFile: path.join(directory, 'documents.jsonl'), meanOccupiedRegions: descriptors.reduce((sum, descriptor) => sum + descriptor.occupiedRegions, 0) / descriptors.length, meanMembershipsPerPixel: descriptors.reduce((sum, descriptor) => sum + descriptor.totalMembership / descriptor.pixelCount, 0) / descriptors.length, encoder: encoder.stats() };
  await writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
  await writeFile(path.join(OVERLAP_STORE, 'current.json'), JSON.stringify({ directory, ...metadata }, null, 2));
  return { documents, metadata, directory };
}

export async function verifyOverlapIndex({ index = OVERLAP_INDEX, expectedIds } = {}) {
  safeIndexName(index);
  const ids = expectedIds ?? (await loadExpandedCorpus()).map(asset => asset.id);
  if (!ids.length || ids.length > 10000 || new Set(ids).size !== ids.length) throw Error('Expected unique complete real corpus IDs, at most10000');
  const stored = await loadStored(), mapping = (await api(index + '/_mapping')).body[index]?.mappings;
  assertFingerprints(mapping?._meta, stored.metadata);
  if (mapping?._meta?.descriptorHash !== stored.metadata.descriptorHash) throw Error('Overlap index descriptorHash mismatch');
  const response = (await api(index + '/_search', { method: 'POST', body: { size: ids.length, _source: false, track_total_hits: true, sort: [{ id: 'asc' }], query: { match_all: {} } } })).body;
  if (response.timed_out || response._shards?.failed) throw Error('Overlap ID verification returned partial results');
  const actual = response.hits.hits.map(hit => hit._id).sort(), expected = [...ids].sort();
  if (response.hits.total?.value !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Overlap index does not contain exactly the expected corpus IDs');
  return { index, count: actual.length, completeIdsVerified: true, ...stored.metadata, indexMetadata: mapping._meta };
}

export async function buildOverlapIndex(input = {}) {
  const index = typeof input === 'string' ? input : input.index ?? OVERLAP_INDEX;
  safeIndexName(index);
  const { documents, metadata } = await prepareDocuments(), mapping = overlapMapping(), started = performance.now();
  mapping.mappings._meta = { experiment: 'overlapping-coverage-quality', ...metadata };
  // Fail if present: never silently replace a completed comparison index.
  await api(index, { method: 'PUT', body: mapping });
  for (let offset = 0; offset < documents.length; offset += 25) await bulkIndex(index, documents.slice(offset, offset + 25));
  await finishIndex(index);
  const validation = await verifyOverlapIndex({ index, expectedIds: documents.map(document => document.id) });
  const result = { schemaVersion: 1, ...validation, indexedAt: new Date().toISOString(), indexMs: performance.now() - started, version: (await api('')).body.version, stats: (await api(index + '/_stats/store,docs,segments')).body._all };
  await writeFile(path.join(STORE, index + '.json'), JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), index = args.find(argument => argument.startsWith('color-exploration-')) ?? OVERLAP_INDEX;
  console.log(JSON.stringify(args.includes('--verify') ? await verifyOverlapIndex({ index }) : await buildOverlapIndex({ index }), null, 2));
}
