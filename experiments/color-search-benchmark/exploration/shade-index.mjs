// THROWAWAY PROTOTYPE: offline shade measurements in separate, provenance-bound indexes.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { FEATURE_NAMES, rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { OVERLAP_BUCKET_COUNTS, overlapRegionsForCount } from './overlap-banks.mjs';
import { loadOverlapDocuments, verifyOverlapIndex, overlapFingerprints } from './overlap-index.mjs';
import { CUTOFF_LEVELS, cutoffFields } from './cutoff-definition.mjs';
import { shadeCoordinates, shadeQualityForCoordinates, shadeDefinition, shadeIndexForCount } from './shade-definition.mjs';
import { api, finishIndex, safeIndexName, loadExpandedCorpus, STORE, hash } from './service.mjs';

export const SHADE_STORE = path.join(STORE, 'shades');
export const SHADE_SOURCE_FILES = Object.freeze(['shade-definition.mjs', 'shade-index.mjs', 'cutoff-definition.mjs', 'cutoff-blend.mjs', 'overlap-regions.mjs', 'overlap-banks.mjs', 'overlap-index.mjs', 'corpus-colors.mjs']);
export const SHADE_MEASUREMENTS = Object.freeze(CUTOFF_LEVELS.map(({ cutoff }) => Object.freeze({ kernel: 'hard', cutoff })));
const sharp = createRequire(new URL('../../../apps/color-extractor/package.json', import.meta.url))('sharp');
sharp.concurrency(1); sharp.cache({ memory: 32, files: 0, items: 20 });
const anchorCount = OVERLAP_REGIONS.length, anchors = OVERLAP_REGIONS.map(region => shadeCoordinates(region.lab));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

export function createShadeEncoder({ cacheLimit = 8192 } = {}) {
  if (!Number.isSafeInteger(cacheLimit) || cacheLimit < 0) throw Error('Invalid shade RGB cache limit.');
  const cache = new Map();
  let documents = 0, cacheHits = 0, rgbCalculations = 0, distanceCalculations = 0;
  function contributions(rgb) {
    const cached = cache.get(rgb);
    if (cached) { cacheHits++; return cached; }
    rgbCalculations++;
    const pixel = shadeCoordinates(rgbToLab([(rgb >>> 16) / 255, ((rgb >>> 8) & 255) / 255, (rgb & 255) / 255]));
    const indexes = [], qualities = [];
    for (let index = 0; index < anchorCount; index++) {
      const match = shadeQualityForCoordinates(pixel, anchors[index]);
      distanceCalculations++;
      if (match.support) { indexes.push(index); qualities.push(match.referenceQuality); }
    }
    const result = { indexes: Uint16Array.from(indexes), qualities: Float64Array.from(qualities) };
    if (cacheLimit) {
      if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value);
      cache.set(rgb, result);
    }
    return result;
  }
  return {
    encodePixels(rgba) {
      if (!rgba?.length || rgba.length % 4) throw Error('Expected nonempty RGBA pixels.');
      const colors = new Map(), pixelCount = rgba.length / 4;
      for (let offset = 0; offset < rgba.length; offset += 4) {
        const alpha = rgba[offset + 3] / 255;
        const rgb = (Math.round(rgba[offset] * alpha) << 16) | (Math.round(rgba[offset + 1] * alpha) << 8) | Math.round(rgba[offset + 2] * alpha);
        colors.set(rgb, (colors.get(rgb) ?? 0) + 1);
      }
      const masses = new Float64Array(5 * anchorCount), qualityMasses = new Float64Array(5 * anchorCount);
      for (const [rgb, count] of colors) {
        const { indexes, qualities } = contributions(rgb);
        for (let nearby = 0; nearby < indexes.length; nearby++) {
          const index = indexes[nearby], quality = qualities[nearby];
          for (let level = 0; level < CUTOFF_LEVELS.length; level++) {
            const cutoff = CUTOFF_LEVELS[level].cutoff;
            if (quality + 1e-12 < cutoff) break;
            const offset = level * anchorCount + index;
            masses[offset] += count; qualityMasses[offset] += count * Math.max(cutoff, quality);
          }
        }
      }
      documents++;
      return { pixelCount, measurements: SHADE_MEASUREMENTS.map((measurement, level) => ({ ...measurement,
        coverage: Array.from({ length: anchorCount }, (_, index) => Math.round(masses[level * anchorCount + index] / pixelCount * 10000)),
        quality: Array.from({ length: anchorCount }, (_, index) => {
          const offset = level * anchorCount + index;
          return masses[offset] ? Math.fround(qualityMasses[offset] / masses[offset]) : 0;
        }),
      })) };
    },
    stats() { return { documents, cacheHits, rgbCalculations, distanceCalculations, cacheEntries: cache.size, cacheLimit }; },
  };
}
export async function extractShade(input, { encoder = createShadeEncoder() } = {}) {
  const bytes = typeof input === 'string' ? await readFile(input) : input;
  const pixels = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().resize(128, 128, { fit: 'fill' }).raw().toBuffer();
  return encoder.encodePixels(pixels);
}
function validateDescriptor(descriptor) {
  if (!Number.isInteger(descriptor?.pixelCount) || descriptor.pixelCount < 1 || descriptor.measurements?.length !== 5) throw Error('Expected complete measured shade descriptor.');
  for (let i = 0; i < 5; i++) {
    const data = descriptor.measurements[i];
    if (data.kernel !== 'hard' || data.cutoff !== CUTOFF_LEVELS[i].cutoff || data.coverage?.length !== anchorCount || data.quality?.length !== anchorCount) throw Error('Shade descriptor measurement layout differs.');
    if (!data.coverage.every(value => Number.isInteger(value) && value >= 0 && value <= 10000) || !data.quality.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw Error('Invalid measured shade coverage or quality.');
    for (let j = 0; j < anchorCount; j++) {
      if (i && data.coverage[j] > descriptor.measurements[i - 1].coverage[j]) throw Error('Shade nested coverage is not monotonic.');
      if (data.coverage[j] > 0 && data.quality[j] + 1e-7 < data.cutoff) throw Error('Shade conditional quality falls below admission level.');
    }
  }
}
export function toShadeDocument(feature, descriptor, bucketCount = 1024) {
  validateDescriptor(descriptor);
  if (!feature.id) throw Error('Expected wallpaper ID.');
  const document = { id: feature.id, reference_id: feature.reference_id ?? feature.id, cohort: feature.cohort ?? 'real', partition: feature.partition ?? 0, tags: feature.tags ?? [], overlap_pixel_total: descriptor.pixelCount };
  for (const name of FEATURE_NAMES) for (const prefix of ['cov_', 'quality_']) if (feature[prefix + name] != null) document[prefix + name] = feature[prefix + name];
  for (const region of overlapRegionsForCount(bucketCount)) for (const measured of descriptor.measurements) {
    const fields = cutoffFields(region.index, 'hard', measured.cutoff);
    document[fields.coverage] = measured.coverage[region.index]; document[fields.quality] = measured.quality[region.index];
  }
  return document;
}
export function shadeMapping({ bucketCount = 1024, source = true, shards = 1 } = {}) {
  const properties = { id: { type: 'keyword' }, reference_id: { type: 'keyword' }, cohort: { type: 'keyword' }, partition: { type: 'integer' }, tags: { type: 'keyword' }, overlap_pixel_total: { type: 'integer' } };
  for (const name of FEATURE_NAMES) { properties['cov_' + name] = { type: 'integer' }; properties['quality_' + name] = { type: 'float' }; }
  for (const region of overlapRegionsForCount(bucketCount)) for (const { cutoff } of CUTOFF_LEVELS) {
    const fields = cutoffFields(region.index, 'hard', cutoff);
    properties[fields.coverage] = { type: 'integer' }; properties[fields.quality] = { type: 'float' };
  }
  return { settings: { number_of_shards: shards, number_of_replicas: 0, refresh_interval: '-1', 'index.mapping.total_fields.limit': Object.keys(properties).length + 20 }, mappings: { dynamic: 'strict', _source: { enabled: source }, properties } };
}
async function preparationPlan() {
  const originalFingerprints = await overlapFingerprints(), corpus = await loadExpandedCorpus();
  const sourceHashes = Object.fromEntries(await Promise.all(SHADE_SOURCE_FILES.map(async name => [name, hash(await readFile(new URL(name, import.meta.url)))])));
  const identity = { schemaVersion: 1, definition: shadeDefinition(), measurements: SHADE_MEASUREMENTS, anchorsHash: hash(OVERLAP_REGIONS), originalFingerprints, sourceHashes };
  const identityHash = hash(identity), directory = path.join(SHADE_STORE, identityHash.slice(0, 20));
  return { corpus, identity, identityHash, directory };
}
const checkpointFilename = (directory, id) => path.join(directory, 'descriptors', hash(id).slice(0, 32) + '.json');
async function readCheckpoint(plan, asset, expectedHash) {
  const bytes = await readFile(checkpointFilename(plan.directory, asset.id));
  if (expectedHash && hash(bytes) !== expectedHash) throw Error(`Shade checkpoint hash mismatch: ${asset.id}.`);
  const data = JSON.parse(bytes);
  if (data.id !== asset.id || data.sha256 !== asset.sha256 || data.identityHash !== plan.identityHash) throw Error(`Shade checkpoint provenance mismatch: ${asset.id}.`);
  validateDescriptor(data.descriptor);
  return { descriptor: data.descriptor, descriptorHash: hash(bytes) };
}
async function loadPrepared(plan) {
  plan ??= await preparationPlan();
  const metadata = JSON.parse(await readFile(path.join(plan.directory, 'metadata.json'), 'utf8'));
  if (metadata.identityHash !== plan.identityHash || !equal(metadata.identity, plan.identity) || metadata.count !== plan.corpus.length) throw Error('Shade preparation metadata mismatch.');
  if (!equal(metadata.assets.map(asset => asset.id).sort(), plan.corpus.map(asset => asset.id).sort()) || new Set(metadata.assets.map(asset => asset.id)).size !== plan.corpus.length) throw Error('Shade checkpoint manifest IDs differ from original corpus.');
  if (hash(metadata.assets) !== metadata.descriptorHash) throw Error('Shade checkpoint manifest fingerprint mismatch.');
  for (const [name, expectedHash] of Object.entries(plan.identity.sourceHashes)) if (hash(await readFile(path.join(plan.directory, 'sources', name))) !== expectedHash) throw Error(`Shade source snapshot changed: ${name}.`);
  return { ...plan, metadata };
}
async function originalDocuments() { return new Map((await loadOverlapDocuments()).map(document => [document.id, document])); }
async function prepareShadeDescriptors() {
  const plan = await preparationPlan();
  try { return await loadPrepared(plan); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await verifyOverlapIndex();
  const originals = await originalDocuments();
  if (originals.size !== plan.corpus.length || plan.corpus.some(asset => !originals.has(asset.id))) throw Error('Original measured corpus IDs differ from shade inputs.');
  await mkdir(path.join(plan.directory, 'descriptors'), { recursive: true });
  await mkdir(path.join(plan.directory, 'sources'), { recursive: true });
  for (const name of SHADE_SOURCE_FILES) {
    const filename = path.join(plan.directory, 'sources', name);
    try { if (hash(await readFile(filename)) !== plan.identity.sourceHashes[name]) throw Error(`Shade existing source snapshot differs: ${name}.`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await copyFile(fileURLToPath(new URL(name, import.meta.url)), filename); }
  }
  const encoder = createShadeEncoder(), assets = [], started = performance.now();
  let reused = 0;
  console.error(`Shade checkpoints: ${plan.directory}`);
  for (const asset of plan.corpus) {
    let checkpoint;
    try { checkpoint = await readCheckpoint(plan, asset); reused++; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const bytes = await readFile(asset.filename);
      if (hash(bytes) !== asset.sha256) throw Error(`Source image hash changed: ${asset.id}.`);
      const descriptor = await extractShade(bytes, { encoder });
      if (descriptor.pixelCount !== originals.get(asset.id).overlap_pixel_total) throw Error(`Original pixel preprocessing size differs: ${asset.id}.`);
      const data = JSON.stringify({ id: asset.id, sha256: asset.sha256, identityHash: plan.identityHash, descriptor });
      const filename = checkpointFilename(plan.directory, asset.id);
      await writeFile(filename + '.tmp', data); await rename(filename + '.tmp', filename);
      checkpoint = { descriptor, descriptorHash: hash(data) };
    }
    assets.push({ id: asset.id, sha256: asset.sha256, descriptorHash: checkpoint.descriptorHash });
    if (assets.length % 10 === 0 || assets.length === plan.corpus.length) console.error(`Shade extraction ${assets.length}/${plan.corpus.length}; ${reused} reused; ${Math.round((performance.now() - started) / 1000)}s`);
  }
  const metadata = { schemaVersion: 1, identity: plan.identity, identityHash: plan.identityHash, count: assets.length, assets, descriptorHash: hash(assets), directory: plan.directory, sourceDirectory: path.join(plan.directory, 'sources'), createdAt: new Date().toISOString(), extractionMs: performance.now() - started, encoder: encoder.stats() };
  await writeFile(path.join(plan.directory, 'metadata.json.tmp'), JSON.stringify(metadata, null, 2));
  await rename(path.join(plan.directory, 'metadata.json.tmp'), path.join(plan.directory, 'metadata.json'));
  await writeFile(path.join(SHADE_STORE, 'current.json'), JSON.stringify({ directory: plan.directory, identityHash: plan.identityHash, count: metadata.count }, null, 2));
  return { ...plan, metadata };
}
async function projectedDocument(prepared, asset, originals, bucketCount) {
  const expected = prepared.metadata.assets.find(candidate => candidate.id === asset.id);
  const { descriptor } = await readCheckpoint(prepared, asset, expected.descriptorHash);
  const original = originals.get(asset.id);
  if (!original || descriptor.pixelCount !== original.overlap_pixel_total) throw Error(`Missing or mismatched original wallpaper measurement: ${asset.id}.`);
  return toShadeDocument(original, descriptor, bucketCount);
}
export async function loadShadeDocuments(bucketCount = 1024) {
  overlapRegionsForCount(bucketCount);
  const prepared = await loadPrepared(), originals = await originalDocuments(), documents = [];
  for (const asset of prepared.corpus) documents.push(await projectedDocument(prepared, asset, originals, bucketCount));
  return documents;
}
function indexMetadata(prepared, bucketCount) {
  return { experiment: 'shade-aware-cutoff-coverage-quality', schemaVersion: 1, metric: 'shade-aware', bucketCount, count: prepared.metadata.count, identityHash: prepared.identityHash, descriptorHash: prepared.metadata.descriptorHash, sourceHashes: prepared.identity.sourceHashes, anchorsHash: hash(overlapRegionsForCount(bucketCount)), directory: prepared.directory };
}
async function verifyExisting({ prepared, originals, bucketCount, index, allowIncomplete = false, expectedIds }) {
  const expected = prepared.corpus.map(asset => asset.id).sort(), expectedSet = new Set(expected);
  if (expectedIds && !equal([...expectedIds].sort(), expected)) throw Error('Shade verifier requires all original corpus IDs.');
  const mapping = (await api(index + '/_mapping')).body[index]?.mappings, metadata = indexMetadata(prepared, bucketCount);
  if (mapping?.dynamic !== 'strict' || mapping?._source?.enabled === false || !equal(mapping?.properties, shadeMapping({ bucketCount }).mappings.properties) || !equal(mapping?._meta, metadata)) throw Error('Shade index mapping or provenance differs from measured inputs.');
  const response = (await api(index + '/_search', { method: 'POST', body: { size: expected.length + 1, _source: false, track_total_hits: true, sort: [{ id: 'asc' }], query: { match_all: {} } } })).body;
  const ids = response.hits.hits.map(hit => hit._id), actualSet = new Set(ids);
  if (response.timed_out || response._shards?.failed || response.hits.total?.value !== ids.length || actualSet.size !== ids.length || ids.some(id => !expectedSet.has(id)) || (!allowIncomplete && !equal([...ids].sort(), expected))) throw Error('Shade index must contain exactly expected corpus IDs.');
  const assets = prepared.corpus.filter(asset => actualSet.has(asset.id)), valueHashes = [];
  for (let offset = 0; offset < assets.length; offset += 5) {
    const batch = assets.slice(offset, offset + 5), hits = (await api(index + '/_mget', { method: 'POST', body: { ids: batch.map(asset => asset.id) } })).body.docs;
    for (let i = 0; i < batch.length; i++) {
      const document = await projectedDocument(prepared, batch[i], originals, bucketCount), actual = hits[i];
      if (!actual.found || actual._id !== document.id || !equal(actual._source, document)) throw Error(`Shade indexed values differ from measured source: ${document.id}.`);
      valueHashes.push({ id: document.id, hash: hash(document) });
    }
  }
  return { ...metadata, index, completeIdsVerified: ids.length === expected.length, allValuesVerified: true, metricDefinitionVerified: true, valuesHash: hash(valueHashes), indexMetadata: mapping._meta, existingIds: ids };
}
export async function verifyShadeIndex({ bucketCount = 1024, index = shadeIndexForCount(bucketCount), expectedIds } = {}) {
  overlapRegionsForCount(bucketCount); safeIndexName(index);
  const prepared = await loadPrepared(), originals = await originalDocuments();
  const { existingIds, ...verification } = await verifyExisting({ bucketCount, index, expectedIds, prepared, originals });
  return verification;
}
export async function prepareShadeIndexes({ counts = OVERLAP_BUCKET_COUNTS } = {}) {
  if (!counts.length || new Set(counts).size !== counts.length) throw Error('Expected unique shade bucket counts.');
  counts.forEach(count => overlapRegionsForCount(count));
  const prepared = await prepareShadeDescriptors(), originals = await originalDocuments(), results = [];
  for (const bucketCount of counts) {
    const index = shadeIndexForCount(bucketCount), started = performance.now();
    let present = true;
    try { await api(index + '/_mapping'); } catch (error) { if (/^OpenSearch 404:/.test(error.message)) present = false; else throw error; }
    if (!present) {
      const mapping = shadeMapping({ bucketCount }); mapping.mappings._meta = indexMetadata(prepared, bucketCount);
      await api(index, { method: 'PUT', body: mapping });
    }
    // Every existing ID/value must match before adding anything. No overwriting is permitted.
    await api(index + '/_refresh', { method: 'POST' });
    const existing = await verifyExisting({ prepared, originals, bucketCount, index, allowIncomplete: true });
    const existingIds = new Set(existing.existingIds), missing = prepared.corpus.filter(asset => !existingIds.has(asset.id));
    if (missing.length) await api(index + '/_settings', { method: 'PUT', body: { index: { refresh_interval: '-1' } } });
    for (let offset = 0; offset < missing.length; offset++) {
      const document = await projectedDocument(prepared, missing[offset], originals, bucketCount);
      const body = JSON.stringify({ create: { _id: document.id } }) + '\n' + JSON.stringify(document) + '\n';
      const response = (await api(index + '/_bulk', { method: 'POST', body, timeoutMs: 300000 })).body;
      if (response.errors) throw Error(`Shade create-only bulk failed: ${JSON.stringify(response.items).slice(0, 1800)}`);
      if ((offset + 1) % 25 === 0) await api(index + '/_flush', { method: 'POST', timeoutMs: 300000 });
      if ((offset + 1) % 100 === 0 || offset + 1 === missing.length) console.error(`Shade ${bucketCount} indexing ${existingIds.size + offset + 1}/${prepared.corpus.length}`);
    }
    if (missing.length) { await api(index + '/_flush', { method: 'POST', timeoutMs: 300000 }); await finishIndex(index); }
    const { existingIds: ignored, ...verification } = await verifyExisting({ prepared, originals, bucketCount, index });
    const result = { ...verification, reused: present, added: missing.length, indexedAt: new Date().toISOString(), indexMs: performance.now() - started, stats: (await api(index + '/_stats/store,docs,segments')).body._all };
    await writeFile(path.join(STORE, index + '.json'), JSON.stringify(result, null, 2)); results.push(result);
    console.error(`Shade ${bucketCount} ready: ${result.count} wallpapers, ${result.stats.primaries.store.size_in_bytes} bytes.`);
  }
  return results;
}
export const buildShadeIndexes = prepareShadeIndexes;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--counts'), counts = at < 0 ? OVERLAP_BUCKET_COUNTS : args[at + 1]?.split(',').map(Number);
  if (!counts?.length || new Set(counts).size !== counts.length) throw Error('Provide unique --counts 16,64,256,1024.');
  const results = args.includes('--verify') ? await (async () => { const out = []; for (const bucketCount of counts) out.push(await verifyShadeIndex({ bucketCount })); return out; })() : await prepareShadeIndexes({ counts });
  console.log(JSON.stringify(results.map(result => ({ bucketCount: result.bucketCount, index: result.index, count: result.count, completeIdsVerified: result.completeIdsVerified, allValuesVerified: result.allValuesVerified, metricDefinitionVerified: result.metricDefinitionVerified, valuesHash: result.valuesHash, reused: result.reused, added: result.added, directory: result.directory, indexMs: result.indexMs, storeBytes: result.stats?.primaries?.store?.size_in_bytes })), null, 2));
}
