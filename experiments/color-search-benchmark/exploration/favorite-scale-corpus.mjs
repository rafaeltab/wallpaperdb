// Performance inputs only. Frozen strict-hue measurements; never service-side reranking.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { HUE_SOURCE_FILES, loadHueDocuments, hueMapping } from './hue-index.mjs';
import { resolveCutoffTargets } from './methods-cutoff.mjs';
import { syntheticOverlapDocument, OVERLAP_SYNTHETIC_PROVENANCE } from './overlap-scale-corpus.mjs';
import { loadExpandedCorpus, hash } from './service.mjs';

export const FAVORITE_SNAPSHOT_ID = 'strict-hue-favorite-001';
export const FAVORITE_SNAPSHOT_SHA256 = '0c73fec9b5c8f3844c23b5d2e3b06738852ea32b8f333896b6bb4fd3c89ca7ad';
export const FAVORITE_INDEX_PREFIX = 'color-exploration-favorite-';
export const FAVORITE_METHOD = 'cutoff-shade-hue-all-levels';
export const FAVORITE_PARAMETERS = Object.freeze({
  cutoffBlendExponent: 1, qualityCurve: 'linear', qualityInfluence: .5,
  minimumQuality: 0, namedMode: 'concrete-swatches', areaPower: .5,
  qualityPenalty: .35, excessPenalty: 1.5, pixelCutoff: 0,
});
export const FAVORITE_VARIANTS = Object.freeze([256, 1024].map(bucketCount => Object.freeze({
  id: `${FAVORITE_SNAPSHOT_ID}-${bucketCount}`, method: FAVORITE_METHOD, bucketCount,
  parameters: Object.freeze({ ...FAVORITE_PARAMETERS, bucketCount }),
})));
const baseWorkload = [
  { id: 'picked-one-vibe', query: { mode: 'vibe', targets: [{ color: '#ff0000' }] } },
  { id: 'picked-one-green40', query: { mode: 'proportions', targets: [{ color: '#22cc44', percent: 40 }] } },
  { id: 'picked-two-portions', query: { mode: 'proportions', targets: [{ color: '#ff2200', percent: 50 }, { color: '#22cc44', percent: 50 }] } },
  { id: 'picked-five-portions', query: { mode: 'proportions', targets: ['#ff2200', '#ff8800', '#ffff00', '#22cc44', '#2266ff'].map(color => ({ color, percent: 20 })) } },
];
export const FAVORITE_WORKLOAD = Object.freeze(baseWorkload.flatMap(item => [
  { ...item, selectivity: 'all' },
  { ...item, id: item.id + '-partition10', selectivity: 'partition10', filter: { range: { partition: { lt: 10 } } } },
  { ...item, id: item.id + '-tag1', selectivity: 'tag1', filter: { term: { tags: 'synthetic-one-percent' } } },
]));
export const FAVORITE_SYNTHETIC_LIMITATIONS = Object.freeze([
  ...OVERLAP_SYNTHETIC_PROVENANCE.limitations,
  'Only the 523 original real images supply mixture colors. All 545 original measurements, including 22 controlled fixtures, are verified before selecting those sources.',
  'Coverage is rounded to basis points and quality to float32. Shared mixture weights preserve distribution relationships subject to that measurement precision.',
  'Synthetic overlap_pixel_total=16384 records the source measurement resolution, not a newly extracted photograph or literal mixture pixel count.',
]);
const metadataProperties = {
  id: { type: 'keyword' }, reference_id: { type: 'keyword' }, cohort: { type: 'keyword' },
  partition: { type: 'integer' }, tags: { type: 'keyword' }, overlap_pixel_total: { type: 'integer' },
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function favoriteProjectionFields(variants = FAVORITE_VARIANTS, workload = FAVORITE_WORKLOAD) {
  const fields = new Set();
  for (const variant of variants) for (const item of workload) {
    const resolved = resolveCutoffTargets(variant.method, item.query, { parameters: variant.parameters });
    for (const target of resolved.targets) for (const component of target.components) {
      fields.add(component.coverageField); fields.add(component.qualityField);
    }
  }
  return [...fields].sort();
}
export function favoriteProjectionMapping(fields) {
  const properties = { ...metadataProperties };
  for (const field of fields) {
    if (!/^(cov|quality)_o\d{4}_hard_q(00|25|50|75|90)$/.test(field)) throw Error('Unexpected favorite projection field: ' + field);
    properties[field] = { type: field.startsWith('cov_') ? 'integer' : 'float' };
  }
  return { settings: { number_of_shards: 1, number_of_replicas: 0, refresh_interval: '-1', 'index.mapping.total_fields.limit': Object.keys(properties).length + 20 },
    mappings: { dynamic: 'strict', _source: { enabled: false }, properties } };
}
export function projectFavoriteDocument(document, fields) {
  if (typeof document.id !== 'string' || !document.id) throw Error('Missing measured document ID.');
  const result = { id: document.id, reference_id: document.reference_id ?? document.id,
    cohort: document.cohort ?? 'real', partition: document.partition ?? 0, tags: document.tags ?? [], overlap_pixel_total: document.overlap_pixel_total ?? 16384 };
  for (const field of fields) {
    const value = document[field], coverage = field.startsWith('cov_');
    if (!Number.isFinite(value) || value < 0 || value > (coverage ? 10000 : 1) || (coverage && !Number.isInteger(value))) throw Error('Missing or invalid favorite measurement: ' + field);
    result[field] = value;
  }
  return result;
}
export function favoriteSyntheticDocument(documents, index, { seed = 99539473, coverageFields } = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error('Favorite generator seed must be a uint32.');
  const result = syntheticOverlapDocument(documents, index, { seed, coverageFields });
  result.id = `favorite-synthetic-${String(index).padStart(9, '0')}`;
  result.cohort = 'favorite-synthetic-mixture';
  result.tags = ['synthetic-all', ...(result.partition < 10 ? ['synthetic-ten-percent'] : []), ...(result.partition === 1 ? ['synthetic-one-percent'] : [])];
  result.overlap_pixel_total = 16384;
  return result;
}
export function favoriteEligibleCount(count, item) {
  if (!Number.isSafeInteger(count) || count < 0) throw Error('Invalid document count.');
  if (item.selectivity === 'partition10') return Math.floor(count / 100) * 10 + Math.min(10, count % 100);
  if (item.selectivity === 'tag1') return Math.floor(count / 100) + Number(count % 100 > 1);
  if (item.selectivity !== 'all') throw Error('Unknown favorite workload selectivity.');
  return count;
}

export function assertFavoriteSnapshotPins(snapshot, { manifestHash, archiveHash, inventoryHash, sourceHashes }) {
  if (manifestHash !== FAVORITE_SNAPSHOT_SHA256 || snapshot.id !== FAVORITE_SNAPSHOT_ID || snapshot.method?.id !== FAVORITE_METHOD) throw Error('Favorite snapshot manifest differs.');
  if (archiveHash !== snapshot.sourceArchive?.sha256) throw Error('Favorite source archive fingerprint differs.');
  if (inventoryHash !== snapshot.sourceArchive?.inventory?.sha256) throw Error('Favorite source inventory fingerprint differs.');
  const preferences = snapshot.userPreferences;
  if (!equal(preferences.jointFavoriteBucketCounts, [256, 1024]) || preferences.preferredCutoffBlendExponent !== 1 || preferences.preferredQualityCurve !== 'linear' || preferences.preferredQualityInfluence !== .5) throw Error('Favorite snapshot parameters differ.');
  if (Object.keys(snapshot.measurements.sourceHashes).length !== HUE_SOURCE_FILES.length) throw Error('Favorite extraction source set differs.');
  for (const file of HUE_SOURCE_FILES) if (!sourceHashes[file] || sourceHashes[file] !== snapshot.measurements.sourceHashes[file]) throw Error('Favorite extraction source fingerprint differs: ' + file);
  for (const variant of FAVORITE_VARIANTS) {
    const recorded = snapshot.feedbackConfiguration.evaluation.candidates.find(candidate => candidate.bucketCount === variant.bucketCount);
    if (!recorded || !equal(recorded.parameters, variant.parameters)) throw Error('Favorite snapshot candidate parameters differ.');
  }
  return true;
}
async function readVerifiedFile(record, label) {
  const bytes = await readFile(record.path);
  if (hash(bytes) !== record.sha256) throw Error(`${label} fingerprint differs.`);
  return bytes;
}

// This function performs filesystem reads only; it never contacts any service.
export async function loadFavoriteScaleInputs({ scope = 'projection', bucketCount } = {}) {
  if (!['projection', 'full'].includes(scope) || (scope === 'full' && ![256, 1024].includes(bucketCount)) || (scope === 'projection' && bucketCount != null)) throw Error('Use projection without bucketCount, or full with bucketCount256/1024.');
  const manifestBytes = await readFile(new URL('./snapshots/strict-hue-favorite-001.json', import.meta.url)), snapshot = JSON.parse(manifestBytes);
  const archiveBytes = await readVerifiedFile(snapshot.sourceArchive, 'Favorite source archive');
  const inventoryBytes = await readVerifiedFile(snapshot.sourceArchive.inventory, 'Favorite source inventory'), inventory = JSON.parse(inventoryBytes);
  const sourceHashes = Object.fromEntries(await Promise.all(HUE_SOURCE_FILES.map(async file => [file, hash(await readFile(new URL(file, import.meta.url)))])));
  assertFavoriteSnapshotPins(snapshot, { manifestHash: hash(manifestBytes), archiveHash: hash(archiveBytes), inventoryHash: hash(inventoryBytes), sourceHashes });
  const querySourceFiles = ['methods-cutoff.mjs', 'methods-overlap.mjs', 'quality-curve.mjs', 'query.mjs', '../ranges.mjs', '../proportions.mjs'];
  const querySourceHashes = {};
  for (const file of querySourceFiles) {
    const relative = path.posix.normalize('experiments/color-search-benchmark/exploration/' + file);
    const actual = hash(await readFile(new URL(file, import.meta.url)));
    if (!inventory.files[relative] || inventory.files[relative].sha256 !== actual) throw Error('Favorite query source differs from archive: ' + file);
    querySourceHashes[file] = actual;
  }
  const metadata = JSON.parse(await readVerifiedFile(snapshot.measurements.metadata, 'Favorite measurement metadata'));
  const currentMetadata = await readFile(path.join(snapshot.measurements.directory, 'metadata.json'));
  if (hash(currentMetadata) !== snapshot.measurements.metadata.sha256 || metadata.identityHash !== snapshot.measurements.identityHash || hash(metadata.identity) !== metadata.identityHash || hash(metadata.assets) !== snapshot.measurements.descriptorHash) throw Error('Favorite measurement identity differs.');
  const corpus = await loadExpandedCorpus();
  const corpusIds = corpus.map(asset => asset.id).sort();
  if (corpus.length !== 545 || new Set(corpusIds).size !== 545 || !equal(corpusIds, metadata.assets.map(asset => asset.id).sort())) throw Error('Favorite requires the original complete545asset corpus.');
  const realIds = new Set(corpus.filter(asset => ['prior-wallpaper', 'wallpapermadness'].includes(asset.cohort)).map(asset => asset.id));
  if (realIds.size !== 523 || corpus.filter(asset => asset.cohort === 'controlled-fixture').length !== 22) throw Error('Favorite real/fixture source cohorts differ.');
  const variants = scope === 'projection' ? [...FAVORITE_VARIANTS] : FAVORITE_VARIANTS.filter(variant => variant.bucketCount === bucketCount);
  const mapping = scope === 'projection' ? favoriteProjectionMapping(favoriteProjectionFields()) : hueMapping({ bucketCount, source: true });
  const fields = Object.keys(mapping.mappings.properties).filter(field => /^(cov|quality)_/.test(field)).sort();
  let documents;
  const receipts = [];
  for (const count of [256, 1024]) {
    const saved = snapshot.measurements.indices.find(index => index.bucketCount === count);
    const archivedReceipt = JSON.parse(await readVerifiedFile(saved.receipt, 'Favorite measured-index receipt'));
    const currentReceipt = JSON.parse(await readFile(saved.receipt.originalPath));
    for (const receipt of [archivedReceipt, currentReceipt]) {
      if (!receipt.completeIdsVerified || !receipt.allValuesVerified || !receipt.metricDefinitionVerified || receipt.count !== 545 || receipt.metric !== 'shade-hue-aware') throw Error('Favorite requires complete strict-hue verification receipts.');
      for (const key of ['identityHash', 'descriptorHash', 'anchorsHash', 'valuesHash']) if (receipt[key] !== saved[key]) throw Error('Favorite measured receipt differs: ' + key);
      if (!equal(receipt.sourceHashes, sourceHashes)) throw Error('Favorite receipt source hashes differ.');
    }
    const loaded = await loadHueDocuments(count);
    const valuesHash = hash(loaded.map(document => ({ id: document.id, hash: hash(document) })));
    if (loaded.length !== 545 || !equal(loaded.map(document => document.id).sort(), corpusIds) || valuesHash !== saved.valuesHash) throw Error('Favorite measured document values differ from all-values receipt.');
    receipts.push({ bucketCount: count, index: saved.index, valuesHash, anchorsHash: saved.anchorsHash, receiptSha256: saved.receipt.sha256 });
    if ((scope === 'projection' && count === 1024) || (scope === 'full' && count === bucketCount)) documents = loaded.filter(document => realIds.has(document.id)).map(document => projectFavoriteDocument(document, fields));
  }
  const source = {
    snapshotId: snapshot.id, snapshotManifestHash: hash(manifestBytes), sourceArchiveHash: hash(archiveBytes), sourceInventoryHash: hash(inventoryBytes),
    identityHash: snapshot.measurements.identityHash, descriptorHash: snapshot.measurements.descriptorHash,
    sourceHashes, querySourceHashes, receipts, verifiedOriginalCount: 545, sourceCount: documents.length, excludedFixtureCount: 22,
    realSourceIdsHash: hash([...realIds].sort()), documentsHash: hash(documents),
    sourceSelection: 'expanded-corpus cohorts prior-wallpaper105 and wallpapermadness418; controlled-fixture22 excluded',
    definition: OVERLAP_SYNTHETIC_PROVENANCE, limitations: FAVORITE_SYNTHETIC_LIMITATIONS,
  };
  const fieldsHash = hash(fields), mappingHash = hash(mapping);
  const identity = { snapshotId: snapshot.id, source, scope, bucketCount: bucketCount ?? null, fieldsHash, mappingHash, variants, workloadHash: hash(FAVORITE_WORKLOAD) };
  return { scope, bucketCount: bucketCount ?? null, documents, source, fields, fieldsHash, coverageFields: fields.filter(field => field.startsWith('cov_')),
    mapping, mappingHash, variants, workload: FAVORITE_WORKLOAD, identity, identityHash: hash(identity) };
}
export function dryRunFavoriteInputs({ inputs, samples = 100, seed = 99539473 } = {}) {
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 10000) throw Error('Dry-run samples must be1..10000.');
  const started = performance.now(); let bytes = 0;
  for (let index = 0; index < samples; index++) bytes += Buffer.byteLength(JSON.stringify(favoriteSyntheticDocument(inputs.documents, index, { seed, coverageFields: inputs.coverageFields })));
  return { dryRun: true, noServiceRequests: true, scope: inputs.scope, bucketCount: inputs.bucketCount ?? null, identityHash: inputs.identityHash,
    source: inputs.source, variants: inputs.variants, fields: inputs.fields, colorFieldCount: inputs.fields.length,
    mappedFieldCount: Object.keys(inputs.mapping.mappings.properties).length, samples, seed, elapsedMs: performance.now() - started,
    meanSerializedDocumentBytes: bytes / samples, fullIndexCapacityMeasured: false };
}
