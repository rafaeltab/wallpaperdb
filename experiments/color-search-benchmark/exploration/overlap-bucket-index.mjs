// THROWAWAY PROTOTYPE. Separate real OpenSearch indexes contain exact projections
// of the immutable measured 1024-region corpus. No pixel extraction is repeated.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { OVERLAP_BUCKET_COUNTS, overlapRegionsForCount, overlapDefinitionForCount, overlapIndexForCount } from './overlap-banks.mjs';
import { regionFields } from './overlap-regions.mjs';
import { OVERLAP_INDEX, OVERLAP_STORE, OVERLAP_SOURCE_FILES, overlapMapping, loadOverlapDocuments, verifyOverlapIndex } from './overlap-index.mjs';
import { api, bulkIndex, finishIndex, safeIndexName, STORE, hash } from './service.mjs';

export const OVERLAP_BUCKET_STORE = path.join(OVERLAP_STORE, 'bucket-projections');
export const OVERLAP_BUCKET_SOURCE_FILES = ['overlap-banks.mjs', 'overlap-bucket-index.mjs'];
const regionField = /^(cov|quality)_o\d{4}$/;
const canonicalValue = value => Array.isArray(value) ? value.map(canonicalValue) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])])) : value;
const equalValues = (left, right) => JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
const fingerprintKeys = ['definitionHash', 'computationHash', 'corpusHash', 'featureHash', 'preparationHash', 'descriptorHash'];

export function projectOverlapDocument(document, bucketCount = 1024) {
  const regions = overlapRegionsForCount(bucketCount);
  if (!document || typeof document.id !== 'string' || !document.id) throw Error('Expected source overlap document ID.');
  const keep = new Set();
  for (const region of regions) {
    const fields = regionFields(region.index), coverage = document[fields.coverage], quality = document[fields.quality];
    if (!Number.isInteger(coverage) || coverage < 0 || coverage > 10000) throw Error(`Missing or invalid measured coverage for ${document.id}/${region.key}.`);
    if (!Number.isFinite(quality) || quality < 0 || quality > 1) throw Error(`Missing or invalid measured quality for ${document.id}/${region.key}.`);
    keep.add(fields.coverage); keep.add(fields.quality);
  }
  return Object.fromEntries(Object.entries(document).filter(([field]) => !regionField.test(field) || keep.has(field)));
}

export function overlapBucketMapping({ bucketCount = 1024, ...options } = {}) {
  const regions = overlapRegionsForCount(bucketCount), mapping = overlapMapping(options);
  if (bucketCount === 1024) return mapping;
  const fields = new Set(regions.flatMap(region => Object.values(regionFields(region.index))));
  for (const field of Object.keys(mapping.mappings.properties)) if (regionField.test(field) && !fields.has(field)) delete mapping.mappings.properties[field];
  mapping.settings['index.mapping.total_fields.limit'] = Math.max(100, Object.keys(mapping.mappings.properties).length + 8);
  return mapping;
}

export function validateProjectedOverlapDocuments(actual, original, bucketCount = 1024) {
  overlapRegionsForCount(bucketCount);
  const expected = new Map(original.map(document => [document.id, projectOverlapDocument(document, bucketCount)]));
  const actualIds = actual.map(document => document.id);
  if (original.length !== expected.size || actual.length !== expected.size || new Set(actualIds).size !== expected.size || actualIds.some(id => !expected.has(id))) throw Error('Overlap projection must contain exactly all original corpus IDs.');
  for (const document of actual) if (!equalValues(document, expected.get(document.id))) throw Error(`Overlap projection values differ from measured source: ${document.id}.`);
  return true;
}

async function projectionPlan(bucketCount) {
  overlapRegionsForCount(bucketCount);
  const originalVerification = await verifyOverlapIndex(), original = await loadOverlapDocuments();
  const documents = original.map(document => projectOverlapDocument(document, bucketCount));
  validateProjectedOverlapDocuments(documents, original, bucketCount);
  const originalFingerprints = Object.fromEntries(fingerprintKeys.map(key => [key, originalVerification[key]]));
  const sourceHashes = Object.fromEntries(await Promise.all(OVERLAP_BUCKET_SOURCE_FILES.map(async name => [name, hash(await readFile(new URL(name, import.meta.url)))])));
  const definition = overlapDefinitionForCount(bucketCount), regions = overlapRegionsForCount(bucketCount);
  const identity = { schemaVersion: 1, bucketCount, definition, anchorIndices: regions.map(region => region.index), anchorHash: hash(regions), originalIndex: OVERLAP_INDEX, originalCount: original.length, originalFingerprints, sourceHashes };
  const identityHash = hash(identity), directory = path.join(OVERLAP_BUCKET_STORE, `${bucketCount}-${identityHash.slice(0, 20)}`);
  const data = documents.map(document => JSON.stringify(document)).join('\n') + '\n';
  return { original, documents, data, identity, identityHash, directory, projectionHash: hash(data) };
}

async function loadProjection(plan, { create = false } = {}) {
  const metadataFile = path.join(plan.directory, 'metadata.json'), documentFile = path.join(plan.directory, 'documents.jsonl');
  let metadata;
  try { metadata = JSON.parse(await readFile(metadataFile, 'utf8')); }
  catch (error) {
    if (!create || error.code !== 'ENOENT') throw error;
    await mkdir(path.join(plan.directory, 'sources'), { recursive: true });
    for (const name of [...OVERLAP_SOURCE_FILES, ...OVERLAP_BUCKET_SOURCE_FILES, 'service.mjs']) await copyFile(fileURLToPath(new URL(name, import.meta.url)), path.join(plan.directory, 'sources', name));
    metadata = {
      schemaVersion: 1, identity: plan.identity, identityHash: plan.identityHash,
      bucketCount: plan.identity.bucketCount, count: plan.documents.length, projectionHash: plan.projectionHash,
      definition: plan.identity.definition, originalFingerprints: plan.identity.originalFingerprints,
      originalIndex: OVERLAP_INDEX, anchorIndices: plan.identity.anchorIndices, anchorHash: plan.identity.anchorHash,
      createdAt: new Date().toISOString(), directory: plan.directory, descriptorFile: documentFile,
      sourceDirectory: path.join(plan.directory, 'sources'),
      projection: 'Exact existing scalar values copied from verified original measured documents. Only unselected region pairs are removed; all named features and source metadata are retained.',
    };
    await writeFile(documentFile, plan.data, { flag: 'wx' });
    await writeFile(metadataFile, JSON.stringify(metadata, null, 2), { flag: 'wx' });
  }
  if (!equalValues(metadata.identity, plan.identity) || metadata.identityHash !== plan.identityHash || metadata.projectionHash !== plan.projectionHash || metadata.count !== plan.documents.length || metadata.bucketCount !== plan.identity.bucketCount) throw Error('Overlap projection metadata/provenance mismatch.');
  const bytes = await readFile(documentFile);
  if (hash(bytes) !== plan.projectionHash) throw Error('Overlap projection descriptor bytes differ from immutable source projection.');
  const documents = bytes.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  validateProjectedOverlapDocuments(documents, plan.original, plan.identity.bucketCount);
  for (const [name, expectedHash] of Object.entries(plan.identity.sourceHashes)) if (hash(await readFile(path.join(metadata.sourceDirectory, name))) !== expectedHash) throw Error(`Overlap projection source snapshot changed: ${name}.`);
  return { documents, metadata, directory: plan.directory };
}

export async function loadOverlapBucketDocuments(bucketCount = 1024) {
  if (bucketCount === 1024) return loadOverlapDocuments();
  const plan = await projectionPlan(bucketCount);
  return (await loadProjection(plan)).documents;
}

async function verifyProjectedIndex({ index, bucketCount, expectedIds, plan, stored }) {
  const ids = expectedIds ?? plan.original.map(document => document.id);
  if (!ids.length || ids.length > 10000 || new Set(ids).size !== ids.length || !equalValues([...ids].sort(), plan.original.map(document => document.id).sort())) throw Error('Expected all unique original corpus IDs for projection verification.');
  const mapping = (await api(index + '/_mapping')).body[index]?.mappings;
  const expectedMapping = overlapBucketMapping({ bucketCount }).mappings;
  if (mapping?.dynamic !== 'strict' || mapping?._source?.enabled === false || !equalValues(mapping?.properties, expectedMapping.properties)) throw Error('Overlap bucket index mapping differs from its selected region fields.');
  const expectedMeta = { experiment: 'overlapping-coverage-quality-buckets', ...stored.metadata };
  if (!equalValues(mapping?._meta, expectedMeta)) throw Error('Overlap bucket index metadata/provenance mismatch.');
  const response = (await api(index + '/_search', { method: 'POST', body: { size: ids.length, _source: true, track_total_hits: true, sort: [{ id: 'asc' }], query: { match_all: {} } } })).body;
  if (response.timed_out || response._shards?.failed) throw Error('Overlap projection verification returned partial results.');
  if (response.hits.total?.value !== ids.length || !equalValues(response.hits.hits.map(hit => hit._id).sort(), [...ids].sort())) throw Error('Overlap bucket index does not contain exactly all expected corpus IDs.');
  if (response.hits.hits.some(hit => hit._id !== hit._source?.id)) throw Error('Overlap bucket source ID differs from its service document ID.');
  validateProjectedOverlapDocuments(response.hits.hits.map(hit => hit._source), plan.original, bucketCount);
  return { index, ...stored.metadata, count: ids.length, completeIdsVerified: true, projectionValuesVerified: true, indexMetadata: mapping._meta };
}

export async function verifyOverlapBucketIndex({ bucketCount = 1024, index = overlapIndexForCount(bucketCount), expectedIds } = {}) {
  overlapRegionsForCount(bucketCount); safeIndexName(index);
  if (bucketCount === 1024) return verifyOverlapIndex({ index, expectedIds });
  const plan = await projectionPlan(bucketCount), stored = await loadProjection(plan);
  return verifyProjectedIndex({ index, bucketCount, expectedIds, plan, stored });
}

export async function buildOverlapBucketIndex({ bucketCount = 1024, index = overlapIndexForCount(bucketCount) } = {}) {
  overlapRegionsForCount(bucketCount); safeIndexName(index);
  // Existing measured 1024 corpus is never rebuilt or replaced by this command.
  if (bucketCount === 1024) return { ...await verifyOverlapIndex({ index }), reused: true };
  if (index === OVERLAP_INDEX) throw Error('A projected bank cannot replace the original 1024-region index.');
  const plan = await projectionPlan(bucketCount), stored = await loadProjection(plan, { create: true });
  let present = true;
  try { await api(index + '/_mapping'); }
  catch (error) { if (/^OpenSearch 404:/.test(error.message)) present = false; else throw error; }
  if (present) return { ...await verifyProjectedIndex({ index, bucketCount, plan, stored }), reused: true };
  const started = performance.now(), mapping = overlapBucketMapping({ bucketCount });
  mapping.mappings._meta = { experiment: 'overlapping-coverage-quality-buckets', ...stored.metadata };
  await api(index, { method: 'PUT', body: mapping });
  for (let offset = 0; offset < stored.documents.length; offset += 25) await bulkIndex(index, stored.documents.slice(offset, offset + 25));
  await finishIndex(index);
  const validation = await verifyProjectedIndex({ index, bucketCount, plan, stored });
  const result = { ...validation, indexedAt: new Date().toISOString(), indexMs: performance.now() - started, reused: false, stats: (await api(index + '/_stats/store,docs,segments')).body._all };
  await writeFile(path.join(STORE, index + '.json'), JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), verify = args.includes('--verify'), countsAt = args.indexOf('--counts');
  const counts = countsAt < 0 ? verify ? OVERLAP_BUCKET_COUNTS : [16, 64, 256] : args[countsAt + 1]?.split(',').map(Number);
  if (!counts?.length || new Set(counts).size !== counts.length) throw Error('Provide unique --counts 16,64,256,1024.');
  const results = [];
  for (const bucketCount of counts) {
    const result = await (verify ? verifyOverlapBucketIndex : buildOverlapBucketIndex)({ bucketCount });
    results.push({ bucketCount, index: result.index, count: result.count, completeIdsVerified: result.completeIdsVerified, projectionValuesVerified: result.projectionValuesVerified, reused: result.reused, directory: result.directory, projectionHash: result.projectionHash, indexMs: result.indexMs, storeBytes: result.stats?.primaries?.store?.size_in_bytes });
  }
  console.log(JSON.stringify(results, null, 2));
}
