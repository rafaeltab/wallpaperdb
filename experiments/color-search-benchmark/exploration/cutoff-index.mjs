// THROWAWAY PROTOTYPE: resumable offline membership extraction. OpenSearch ranks.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { FEATURE_NAMES, rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_REGIONS, regionFields } from './overlap-regions.mjs';
import { OVERLAP_BUCKET_COUNTS, overlapRegionsForCount } from './overlap-banks.mjs';
import { loadOverlapDocuments, verifyOverlapIndex, overlapFingerprints } from './overlap-index.mjs';
import { CUTOFF_LEVELS, CUTOFF_KERNELS, CUTOFF_REFERENCE_RADIUS, cutoffFields, cutoffIndexForCount, cutoffDefinition } from './cutoff-definition.mjs';
import { api, bulkIndex, finishIndex, safeIndexName, loadExpandedCorpus, STORE, hash } from './service.mjs';

export const CUTOFF_STORE = path.join(STORE, 'cutoffs');
export const CUTOFF_SOURCE_FILES = ['cutoff-definition.mjs', 'cutoff-index.mjs', 'overlap-regions.mjs', 'overlap-banks.mjs', 'overlap-index.mjs', 'corpus-colors.mjs'];
export const CUTOFF_MEASUREMENTS = Object.freeze(CUTOFF_KERNELS.flatMap(kernel => CUTOFF_LEVELS.map(level => Object.freeze({ kernel, cutoff: level.cutoff }))));
const sharp = createRequire(new URL('../../../apps/color-extractor/package.json', import.meta.url))('sharp');
sharp.concurrency(1); sharp.cache({ memory: 32, files: 0, items: 20 });
const anchorCount = 1024, measurementCount = CUTOFF_MEASUREMENTS.length, radius = CUTOFF_REFERENCE_RADIUS;
const cellKey = (l, a, b) => `${l},${a},${b}`, cells = new Map();
for (const region of OVERLAP_REGIONS) {
  const key = cellKey(...region.lab.map(channel => Math.floor(channel / radius)));
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(region.index);
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function createCutoffEncoder({ cacheLimit = 32768 } = {}) {
  if (!Number.isSafeInteger(cacheLimit) || cacheLimit < 0) throw Error('Invalid cutoff RGB cache limit.');
  const cache = new Map();
  let documents = 0, cacheHits = 0, rgbCalculations = 0, distanceCalculations = 0;
  function contributions(rgb) {
    const cached = cache.get(rgb);
    if (cached) { cacheHits++; return cached; }
    rgbCalculations++;
    const lab = rgbToLab([(rgb >>> 16) / 255, ((rgb >>> 8) & 255) / 255, (rgb & 255) / 255]);
    const cell = lab.map(channel => Math.floor(channel / radius)), indexes = [], distances = [];
    for (let l = cell[0] - 1; l <= cell[0] + 1; l++) for (let a = cell[1] - 1; a <= cell[1] + 1; a++) for (let b = cell[2] - 1; b <= cell[2] + 1; b++) {
      for (const index of cells.get(cellKey(l, a, b)) ?? []) {
        const center = OVERLAP_REGIONS[index].lab;
        const dl = lab[0] - center[0], da = lab[1] - center[1], db = lab[2] - center[2];
        distanceCalculations++;
        const distance = Math.sqrt(dl * dl + da * da + db * db);
        if (distance / radius <= 1 + 1e-12) { indexes.push(index); distances.push(distance); }
      }
    }
    const result = { indexes: Uint16Array.from(indexes), distances: Float64Array.from(distances) };
    if (cacheLimit) {
      if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value);
      cache.set(rgb, result);
    }
    return result;
  }
  return {
    encodePixels(rgba) {
      if (!rgba?.length || rgba.length % 4 !== 0) throw Error('Expected nonempty RGBA pixels.');
      const colors = new Map(), pixelCount = rgba.length / 4;
      for (let offset = 0; offset < rgba.length; offset += 4) {
        const alpha = rgba[offset + 3] / 255;
        const rgb = (Math.round(rgba[offset] * alpha) << 16) | (Math.round(rgba[offset + 1] * alpha) << 8) | Math.round(rgba[offset + 2] * alpha);
        colors.set(rgb, (colors.get(rgb) ?? 0) + 1);
      }
      const masses = new Float64Array(measurementCount * anchorCount), qualityMasses = new Float64Array(measurementCount * anchorCount);
      for (const [rgb, count] of colors) {
        const { indexes, distances } = contributions(rgb);
        for (let nearby = 0; nearby < indexes.length; nearby++) {
          const index = indexes[nearby], distance = distances[nearby];
          for (let levelIndex = 0; levelIndex < CUTOFF_LEVELS.length; levelIndex++) {
            const level = CUTOFF_LEVELS[levelIndex], normalized = distance / level.radius;
            if (normalized > 1 + 1e-12) break;
            const quality = Math.max(level.cutoff, 1 - distance / radius);
            const feather = Math.max(0, 1 - Math.min(1, normalized));
            const hardOffset = levelIndex * anchorCount + index;
            masses[hardOffset] += count; qualityMasses[hardOffset] += count * quality;
            const featherOffset = (5 + levelIndex) * anchorCount + index, featherMass = count * feather;
            masses[featherOffset] += featherMass; qualityMasses[featherOffset] += featherMass * quality;
            const coreOffset = (10 + levelIndex) * anchorCount + index, coreMass = count * Math.min(1, feather * 2);
            masses[coreOffset] += coreMass; qualityMasses[coreOffset] += coreMass * quality;
          }
        }
      }
      documents++;
      return {
        pixelCount, measurements: CUTOFF_MEASUREMENTS.map((measurement, measurementIndex) => ({
          ...measurement,
          coverage: Array.from({ length: anchorCount }, (_, index) => Math.round(masses[measurementIndex * anchorCount + index] / pixelCount * 10000)),
          quality: Array.from({ length: anchorCount }, (_, index) => {
            const offset = measurementIndex * anchorCount + index;
            return masses[offset] ? Math.fround(qualityMasses[offset] / masses[offset]) : 0;
          }),
        })),
      };
    },
    stats() { return { documents, cacheHits, rgbCalculations, distanceCalculations, cacheEntries: cache.size, cacheLimit }; },
  };
}

export async function extractCutoff(input, { encoder = createCutoffEncoder() } = {}) {
  const bytes = typeof input === 'string' ? await readFile(input) : input;
  const pixels = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().resize(128, 128, { fit: 'fill' }).raw().toBuffer();
  return encoder.encodePixels(pixels);
}
function validateDescriptor(descriptor) {
  if (!Number.isInteger(descriptor?.pixelCount) || descriptor.pixelCount < 1 || descriptor.measurements?.length !== measurementCount) throw Error('Expected complete measured cutoff descriptor.');
  for (let i = 0; i < measurementCount; i++) {
    const data = descriptor.measurements[i], expected = CUTOFF_MEASUREMENTS[i];
    if (data.kernel !== expected.kernel || data.cutoff !== expected.cutoff || data.coverage?.length !== anchorCount || data.quality?.length !== anchorCount) throw Error('Cutoff descriptor measurement layout differs.');
    if (!data.coverage.every(value => Number.isInteger(value) && value >= 0 && value <= 10000) || !data.quality.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw Error('Invalid measured cutoff coverage or quality.');
  }
}
export function verifyHard50Parity(descriptor, original) {
  const measured = descriptor.measurements.find(data => data.kernel === 'hard' && data.cutoff === .5);
  if (!measured || descriptor.pixelCount !== original.overlap_pixel_total) throw Error(`Original hard 50% pixel count differs: ${original.id}.`);
  for (const region of OVERLAP_REGIONS) {
    const fields = regionFields(region.index);
    if (measured.coverage[region.index] !== original[fields.coverage] || measured.quality[region.index] !== original[fields.quality]) throw Error(`Original hard 50% measurement differs: ${original.id}/${region.key}.`);
  }
  return true;
}
export function toCutoffDocument(feature, descriptor, bucketCount = 1024) {
  validateDescriptor(descriptor);
  if (!feature.id) throw Error('Expected wallpaper ID.');
  const document = { id: feature.id, reference_id: feature.reference_id ?? feature.id, cohort: feature.cohort ?? 'real', partition: feature.partition ?? 0, tags: feature.tags ?? [], overlap_pixel_total: descriptor.pixelCount };
  for (const name of FEATURE_NAMES) for (const prefix of ['cov_', 'quality_']) if (feature[prefix + name] != null) document[prefix + name] = feature[prefix + name];
  for (const region of overlapRegionsForCount(bucketCount)) for (const measured of descriptor.measurements) {
    const fields = cutoffFields(region.index, measured.kernel, measured.cutoff);
    document[fields.coverage] = measured.coverage[region.index];
    document[fields.quality] = measured.quality[region.index];
  }
  return document;
}
export function cutoffMapping({ bucketCount = 1024, source = true, shards = 1 } = {}) {
  const properties = { id: { type: 'keyword' }, reference_id: { type: 'keyword' }, cohort: { type: 'keyword' }, partition: { type: 'integer' }, tags: { type: 'keyword' }, overlap_pixel_total: { type: 'integer' } };
  for (const name of FEATURE_NAMES) { properties['cov_' + name] = { type: 'integer' }; properties['quality_' + name] = { type: 'float' }; }
  for (const region of overlapRegionsForCount(bucketCount)) for (const { kernel, cutoff } of CUTOFF_MEASUREMENTS) {
    const fields = cutoffFields(region.index, kernel, cutoff);
    properties[fields.coverage] = { type: 'integer' }; properties[fields.quality] = { type: 'float' };
  }
  return { settings: { number_of_shards: shards, number_of_replicas: 0, refresh_interval: '-1', 'index.mapping.total_fields.limit': Object.keys(properties).length + 20 }, mappings: { dynamic: 'strict', _source: { enabled: source }, properties } };
}

async function preparationPlan() {
  const originalFingerprints = await overlapFingerprints(), corpus = await loadExpandedCorpus();
  const sourceHashes = Object.fromEntries(await Promise.all(CUTOFF_SOURCE_FILES.map(async name => [name, hash(await readFile(new URL(name, import.meta.url)))])));
  const identity = { schemaVersion: 1, definition: cutoffDefinition(), measurements: CUTOFF_MEASUREMENTS, anchorsHash: hash(OVERLAP_REGIONS), originalFingerprints, sourceHashes };
  const identityHash = hash(identity), directory = path.join(CUTOFF_STORE, identityHash.slice(0, 20));
  return { corpus, identity, identityHash, directory };
}
const checkpointFilename = (directory, id) => path.join(directory, 'descriptors', hash(id).slice(0, 32) + '.json');
async function readCheckpoint(plan, asset, expectedHash) {
  const bytes = await readFile(checkpointFilename(plan.directory, asset.id));
  if (expectedHash && hash(bytes) !== expectedHash) throw Error(`Cutoff checkpoint hash mismatch: ${asset.id}.`);
  const data = JSON.parse(bytes);
  if (data.id !== asset.id || data.sha256 !== asset.sha256 || data.identityHash !== plan.identityHash) throw Error(`Cutoff checkpoint provenance mismatch: ${asset.id}.`);
  validateDescriptor(data.descriptor);
  return { descriptor: data.descriptor, descriptorHash: hash(bytes) };
}
async function loadPrepared(plan) {
  plan ??= await preparationPlan();
  const metadata = JSON.parse(await readFile(path.join(plan.directory, 'metadata.json'), 'utf8'));
  if (metadata.identityHash !== plan.identityHash || !equal(metadata.identity, plan.identity) || metadata.count !== plan.corpus.length) throw Error('Cutoff preparation metadata mismatch.');
  if (!equal(metadata.assets.map(asset => asset.id).sort(), plan.corpus.map(asset => asset.id).sort()) || new Set(metadata.assets.map(asset => asset.id)).size !== plan.corpus.length) throw Error('Cutoff checkpoint manifest IDs differ from original corpus.');
  if (hash(metadata.assets) !== metadata.descriptorHash) throw Error('Cutoff checkpoint manifest fingerprint mismatch.');
  for (const [name, expectedHash] of Object.entries(plan.identity.sourceHashes)) if (hash(await readFile(path.join(plan.directory, 'sources', name))) !== expectedHash) throw Error(`Cutoff source snapshot changed: ${name}.`);
  return { ...plan, metadata };
}
async function prepareCutoffDescriptors() {
  const plan = await preparationPlan();
  try { return await loadPrepared(plan); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await verifyOverlapIndex();
  const originals = new Map((await loadOverlapDocuments()).map(document => [document.id, document]));
  if (originals.size !== plan.corpus.length || plan.corpus.some(asset => !originals.has(asset.id))) throw Error('Original measured corpus IDs differ from cutoff inputs.');
  await mkdir(path.join(plan.directory, 'descriptors'), { recursive: true });
  await mkdir(path.join(plan.directory, 'sources'), { recursive: true });
  for (const name of CUTOFF_SOURCE_FILES) await copyFile(fileURLToPath(new URL(name, import.meta.url)), path.join(plan.directory, 'sources', name));
  const encoder = createCutoffEncoder(), assets = [], started = performance.now();
  let reused = 0;
  console.error(`Cutoff checkpoints: ${plan.directory}`);
  for (const asset of plan.corpus) {
    let checkpoint;
    try { checkpoint = await readCheckpoint(plan, asset); reused++; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const bytes = await readFile(asset.filename);
      if (hash(bytes) !== asset.sha256) throw Error(`Source image hash changed: ${asset.id}.`);
      const descriptor = await extractCutoff(bytes, { encoder });
      verifyHard50Parity(descriptor, originals.get(asset.id));
      const data = JSON.stringify({ id: asset.id, sha256: asset.sha256, identityHash: plan.identityHash, descriptor });
      const filename = checkpointFilename(plan.directory, asset.id);
      await writeFile(filename + '.tmp', data); await rename(filename + '.tmp', filename);
      checkpoint = { descriptor, descriptorHash: hash(data) };
    }
    verifyHard50Parity(checkpoint.descriptor, originals.get(asset.id));
    assets.push({ id: asset.id, sha256: asset.sha256, descriptorHash: checkpoint.descriptorHash });
    if (assets.length % 10 === 0 || assets.length === plan.corpus.length) console.error(`Cutoff extraction ${assets.length}/${plan.corpus.length}; ${reused} reused; ${Math.round((performance.now() - started) / 1000)}s`);
  }
  const metadata = { schemaVersion: 1, identity: plan.identity, identityHash: plan.identityHash, count: assets.length, assets, descriptorHash: hash(assets), directory: plan.directory, sourceDirectory: path.join(plan.directory, 'sources'), hard50ParityVerified: true, createdAt: new Date().toISOString(), extractionMs: performance.now() - started, encoder: encoder.stats() };
  await writeFile(path.join(plan.directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
  await writeFile(path.join(CUTOFF_STORE, 'current.json'), JSON.stringify({ directory: plan.directory, identityHash: plan.identityHash, count: metadata.count }, null, 2));
  return { ...plan, metadata };
}
async function originalDocuments() { return new Map((await loadOverlapDocuments()).map(document => [document.id, document])); }
async function projectedDocument(prepared, asset, originals, bucketCount) {
  const expected = prepared.metadata.assets.find(candidate => candidate.id === asset.id);
  const { descriptor } = await readCheckpoint(prepared, asset, expected.descriptorHash);
  const original = originals.get(asset.id);
  if (!original) throw Error(`Missing original wallpaper measurement: ${asset.id}.`);
  verifyHard50Parity(descriptor, original);
  return toCutoffDocument(original, descriptor, bucketCount);
}
export async function loadCutoffDocuments(bucketCount = 1024) {
  overlapRegionsForCount(bucketCount);
  const prepared = await loadPrepared(), originals = await originalDocuments(), documents = [];
  for (const asset of prepared.corpus) documents.push(await projectedDocument(prepared, asset, originals, bucketCount));
  return documents;
}
async function indexMetadata(prepared, bucketCount) {
  return { experiment: 'multi-cutoff-overlapping-coverage-quality', schemaVersion: 1, bucketCount, count: prepared.metadata.count, identityHash: prepared.identityHash, descriptorHash: prepared.metadata.descriptorHash, sourceHashes: prepared.identity.sourceHashes, anchorsHash: hash(overlapRegionsForCount(bucketCount)), directory: prepared.directory, hard50ParityVerified: true };
}
async function verifyPreparedIndex({ bucketCount, index, expectedIds, prepared, originals }) {
  const expected = prepared.corpus.map(asset => asset.id).sort();
  if (expectedIds && !equal([...expectedIds].sort(), expected)) throw Error('Cutoff verifier requires all original corpus IDs.');
  const mapping = (await api(index + '/_mapping')).body[index]?.mappings;
  const expectedMapping = cutoffMapping({ bucketCount }).mappings, metadata = await indexMetadata(prepared, bucketCount);
  if (mapping?.dynamic !== 'strict' || mapping?._source?.enabled === false || !equal(mapping?.properties, expectedMapping.properties) || !equal(mapping?._meta, metadata)) throw Error('Cutoff index mapping or provenance differs from measured inputs.');
  const response = (await api(index + '/_search', { method: 'POST', body: { size: expected.length, _source: false, track_total_hits: true, sort: [{ id: 'asc' }], query: { match_all: {} } } })).body;
  if (response.timed_out || response._shards?.failed || response.hits.total?.value !== expected.length || !equal(response.hits.hits.map(hit => hit._id).sort(), expected)) throw Error('Cutoff index must contain exactly every expected corpus ID.');
  const valueHashes = [];
  for (let offset = 0; offset < prepared.corpus.length; offset += 5) {
    const assets = prepared.corpus.slice(offset, offset + 5);
    const hits = (await api(index + '/_mget', { method: 'POST', body: { ids: assets.map(asset => asset.id) } })).body.docs;
    for (let item = 0; item < assets.length; item++) {
      const document = await projectedDocument(prepared, assets[item], originals, bucketCount), actual = hits[item];
      if (!actual.found || actual._id !== document.id || !equal(actual._source, document)) throw Error(`Cutoff indexed values differ from measured source: ${document.id}.`);
      valueHashes.push({ id: document.id, hash: hash(document) });
    }
  }
  return { ...metadata, index, completeIdsVerified: true, allValuesVerified: true, hard50ParityVerified: true, valuesHash: hash(valueHashes), indexMetadata: mapping._meta };
}
export async function verifyCutoffIndex({ bucketCount = 1024, index = cutoffIndexForCount(bucketCount), expectedIds } = {}) {
  overlapRegionsForCount(bucketCount); safeIndexName(index);
  const prepared = await loadPrepared(), originals = await originalDocuments();
  return verifyPreparedIndex({ bucketCount, index, expectedIds, prepared, originals });
}
export async function buildCutoffIndexes({ counts = OVERLAP_BUCKET_COUNTS } = {}) {
  if (!counts.length || new Set(counts).size !== counts.length) throw Error('Expected unique cutoff bucket counts.');
  counts.forEach(count => overlapRegionsForCount(count));
  const prepared = await prepareCutoffDescriptors(), originals = await originalDocuments(), results = [];
  for (const bucketCount of counts) {
    const index = cutoffIndexForCount(bucketCount);
    let present = true;
    try { await api(index + '/_mapping'); } catch (error) { if (/^OpenSearch 404:/.test(error.message)) present = false; else throw error; }
    const started = performance.now();
    if (!present) {
      const mapping = cutoffMapping({ bucketCount }); mapping.mappings._meta = await indexMetadata(prepared, bucketCount);
      await api(index, { method: 'PUT', body: mapping });
      for (let offset = 0; offset < prepared.corpus.length; offset += 5) {
        const batch = [];
        for (const asset of prepared.corpus.slice(offset, offset + 5)) batch.push(await projectedDocument(prepared, asset, originals, bucketCount));
        await bulkIndex(index, batch);
        if ((offset + batch.length) % 100 === 0 || offset + batch.length === prepared.corpus.length) console.error(`Cutoff ${bucketCount} indexing ${offset + batch.length}/${prepared.corpus.length}`);
      }
      await finishIndex(index);
    }
    // An existing incomplete or mismatched index is rejected, never overwritten.
    const verification = await verifyPreparedIndex({ bucketCount, index, prepared, originals });
    const result = { ...verification, reused: present, indexedAt: new Date().toISOString(), indexMs: performance.now() - started, stats: (await api(index + '/_stats/store,docs,segments')).body._all };
    await writeFile(path.join(STORE, index + '.json'), JSON.stringify(result, null, 2));
    results.push(result);
    console.error(`Cutoff ${bucketCount} ready: ${result.count} wallpapers, ${result.stats.primaries.store.size_in_bytes} bytes.`);
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--counts');
  const counts = at < 0 ? OVERLAP_BUCKET_COUNTS : args[at + 1]?.split(',').map(Number);
  if (!counts?.length || new Set(counts).size !== counts.length) throw Error('Provide unique --counts 16,64,256,1024.');
  const results = args.includes('--verify') ? await (async () => { const results = []; for (const bucketCount of counts) results.push(await verifyCutoffIndex({ bucketCount })); return results; })() : await buildCutoffIndexes({ counts });
  console.log(JSON.stringify(results.map(result => ({ bucketCount: result.bucketCount, index: result.index, count: result.count, completeIdsVerified: result.completeIdsVerified, allValuesVerified: result.allValuesVerified, hard50ParityVerified: result.hard50ParityVerified, valuesHash: result.valuesHash, reused: result.reused, directory: result.directory, indexMs: result.indexMs, storeBytes: result.stats?.primaries?.store?.size_in_bytes })), null, 2));
}
