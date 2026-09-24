import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const CORPUS_STORE = process.env.COLOR_EVALUATION_CORPUS ?? path.join(os.homedir(), '.local/share/wallpaperdb/color-evaluation');
export const STORE = process.env.COLOR_EXPLORATION_STORE ?? path.join(CORPUS_STORE, 'exploration');
export const BASE = process.env.COLOR_EXPLORATION_OPENSEARCH ?? 'http://127.0.0.1:19216';
export const INDEX = process.env.COLOR_EXPLORATION_INDEX ?? 'color-exploration-real-v1';
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const json = async filename => JSON.parse(await readFile(filename, 'utf8'));

export function safeIndexName(index) {
  if (!/^color-exploration-[a-z0-9-]+$/.test(index)) throw Error(`Unsafe scratch index name: ${index}`);
  return index;
}

export async function api(route, { method = 'GET', body, signal, timeoutMs = 120000, base = BASE } = {}) {
  const started = performance.now();
  const response = await fetch(`${base}/${route.replace(/^\//, '')}`, {
    method, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': typeof body === 'string' ? 'application/x-ndjson' : 'application/json' },
    body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw Error(`OpenSearch ${response.status}: ${JSON.stringify(data.error ?? data).slice(0, 1800)}`);
  return { body: data, wallMs: performance.now() - started };
}

export function validateSearchResponse(body) {
  if (body.timed_out) throw Error('OpenSearch query timed out; partial hits rejected');
  if (body._shards?.failed) throw Error(`OpenSearch shard failures: ${JSON.stringify(body._shards)}`);
  const seen = new Set();
  return body.hits.hits.map(hit => {
    if (!Number.isFinite(hit._score)) throw Error('OpenSearch returned invalid score');
    if (seen.has(hit._id)) throw Error(`Duplicate service hit ${hit._id}`);
    seen.add(hit._id);
    return { id: hit._id, score: hit._score };
  });
}

export async function searchIndex(index, body, { signal, timeoutMs = 10000 } = {}) {
  const result = await api(`${safeIndexName(index)}/_search?request_cache=false`, { method: 'POST', body, signal, timeoutMs });
  return { hits: validateSearchResponse(result.body), totalEligible: result.body.hits.total?.value,
    evidence: { index, serviceTookMs: result.body.took, httpMs: result.wallMs, totalRelation: result.body.hits.total?.relation } };
}

export function toIndexDocument(feature, fields) {
  const result = { id: feature.id, reference_id: feature.reference_id ?? feature.id, cohort: feature.cohort ?? 'real', partition: feature.partition ?? 0 };
  const passthrough = ['rgb4096', 'pixel_total', 'palette32_packed', 'palette_total', 'palette_cells', 'palette_lab_lw', 'palette_lab_ab', 'coverage_tokens', 'rgb_cdf48_packed'];
  for (const [key, value] of Object.entries(feature))
    if (passthrough.includes(key) || key.startsWith('cov_') || key.startsWith('quality_') || key.startsWith('rel_')) result[key] = value;
  const hsv = feature.hsv64 ?? feature.hsv_l2;
  const rgb = feature.rgb512 ?? feature.rgb_cosine;
  const vectors = {
    hsv_cosine: hsv, hsv_l2: hsv,
    hsv_sqrt: feature.hsv64_sqrt ?? hsv?.map(Math.sqrt),
    rgb_cosine: rgb, rgb_sqrt: rgb?.map(Math.sqrt),
  };
  for (const [key, value] of Object.entries(vectors)) if (value && (!fields || fields.includes(key))) result[key] = value;
  if (fields) return Object.fromEntries(Object.entries(result).filter(([key]) => ['id','reference_id','cohort','partition'].includes(key) || fields.includes(key)));
  return result;
}

export function indexMapping({ fields, source = true, shards = 1 } = {}) {
  const vector = (dimension, space_type) => ({ type: 'knn_vector', dimension, method: { name: 'hnsw', engine: 'lucene', space_type, parameters: { ef_construction: 128, m: 16 } } });
  const properties = {
    id: { type: 'keyword' }, reference_id: { type: 'keyword' }, cohort: { type: 'keyword' }, partition: { type: 'integer' },
    hsv_cosine: vector(64, 'cosinesimil'), hsv_l2: vector(64, 'l2'), hsv_sqrt: vector(64, 'l2'),
    rgb_cosine: vector(512, 'cosinesimil'), rgb_sqrt: vector(512, 'l2'),
    rgb4096: { type: 'long' }, pixel_total: { type: 'integer' }, palette32_packed: { type: 'long' }, palette_total: { type: 'integer' },
    palette_cells: { type: 'keyword' }, palette_lab_lw: { type: 'long' }, palette_lab_ab: { type: 'long' },
    rgb_cdf48_packed: { type: 'long' }, coverage_tokens: { type: 'keyword' },
  };
  if (fields) for (const key of Object.keys(properties)) if (!['id','reference_id','cohort','partition'].includes(key) && !fields.includes(key)) delete properties[key];
  return { settings: { number_of_shards: shards, number_of_replicas: 0, refresh_interval: '-1', 'index.knn': Object.values(properties).some(p => p.type === 'knn_vector') },
    mappings: { _source: { enabled: source }, dynamic_templates: [
      { coverage: { match: 'cov_*', mapping: { type: 'integer' } } },
      { quality: { match: 'quality_*', mapping: { type: 'float' } } },
      { relative: { match: 'rel_*', mapping: { type: 'float' } } },
    ], properties } };
}

export async function loadExpandedCorpus() {
  const data = await json(path.join(CORPUS_STORE, 'expanded-corpus.json'));
  return Array.isArray(data) ? data : data.assets ?? data.corpus;
}
export async function loadFeatures() {
  return (await readFile(path.join(CORPUS_STORE, 'features.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export async function createIndex(index, options = {}) {
  await api(safeIndexName(index), { method: 'PUT', body: indexMapping(options) });
}
export async function bulkIndex(index, documents) {
  safeIndexName(index);
  const body = documents.map(doc => JSON.stringify({ index: { _id: doc.id } }) + '\n' + JSON.stringify(doc) + '\n').join('');
  const result = await api(`${index}/_bulk`, { method: 'POST', body, timeoutMs: 300000 });
  if (result.body.errors) throw Error(`Bulk failed: ${JSON.stringify(result.body.items.filter(item => item.index.error).slice(0, 3))}`);
  return result;
}
export async function finishIndex(index) {
  await api(`${safeIndexName(index)}/_refresh`, { method: 'POST' });
  await api(`${index}/_settings`, { method: 'PUT', body: { index: { refresh_interval: '1s' } } });
  return (await api(`${index}/_count`)).body.count;
}

export async function prepareRealIndex(index = INDEX) {
  const features = await loadFeatures();
  const corpus = await loadExpandedCorpus();
  if (features.length !== corpus.length || new Set(features.map(f => f.id)).size !== corpus.length) throw Error('Corpus/feature cardinality mismatch');
  const ids = new Set(corpus.map(c => c.id));
  if (features.some(f => !ids.has(f.id))) throw Error('Unknown feature ID');
  // Creation is intentionally fail-if-present: an old experiment is never overwritten.
  const started = performance.now();
  await createIndex(index);
  for (let offset = 0; offset < features.length; offset += 100) await bulkIndex(index, features.slice(offset, offset + 100).map(f => toIndexDocument(f)));
  const count = await finishIndex(index);
  if (count !== corpus.length) throw Error('Index did not retain every corpus asset');
  const metadata = { schemaVersion: 1, index, count, createdAt: new Date().toISOString(), indexMs: performance.now() - started,
    corpusHash: hash(corpus.map(c => ({ id: c.id, sha256: c.sha256 }))), featureHash: hash(await readFile(path.join(CORPUS_STORE, 'features.jsonl'))),
    version: (await api('')).body.version, stats: (await api(`${index}/_stats/store,docs`)).body._all };
  await mkdir(STORE, { recursive: true });
  await writeFile(path.join(STORE, `${index}.json`), JSON.stringify(metadata, null, 2));
  return metadata;
}
