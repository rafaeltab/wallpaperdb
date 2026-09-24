// Performance only. Real OpenSearch global ranking of the frozen favorite tuning.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { FAVORITE_VARIANTS, FAVORITE_WORKLOAD, loadFavoriteScaleInputs, favoriteSyntheticDocument, favoriteEligibleCount, dryRunFavoriteInputs } from './favorite-scale-corpus.mjs';
import { buildCutoffQuery, resolveCutoffTargets } from './methods-cutoff.mjs';
import { runWorkload, summarizeTrials, beginInvocation } from './rank-features-scale.mjs';
import { BASE, STORE, api, searchIndex, safeIndexName, hash } from './service.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => hash(canonical(left)) === hash(canonical(right));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const atomicJson = async (filename, value) => { await writeFile(filename + '.tmp', JSON.stringify(value, null, 2)); await rename(filename + '.tmp', filename); };
async function optionalJson(filename) { try { return JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; } }
const strictFailure = row => Boolean(row.error) || row.elapsedMs >= 1000;

export function favoriteScaleConfiguration(args = []) {
  const options = { scope: 'projection', counts: '100000,1000000', concurrency: '1,4,16', requests: '32', 'duration-seconds': '10', 'batch-size': '100', seed: '99539473', samples: '100', 'settle-seconds': '120' };
  const keys = [...Object.keys(options), 'index', 'bucket-count', 'directory', 'resume'];
  for (let cursor = 0; cursor < args.length; cursor++) {
    const flag = args[cursor], key = flag.slice(2);
    if (['--dry-run', '--rerun'].includes(flag)) { options[key] = true; continue; }
    if (!flag.startsWith('--') || !keys.includes(key)) throw Error('Unknown favorite scale option: ' + flag);
    const value = args[++cursor]; if (!value || value.startsWith('--')) throw Error('Missing favorite scale option: ' + flag);
    options[key] = value;
  }
  const config = { scope: options.scope, bucketCount: options['bucket-count'] == null ? undefined : Number(options['bucket-count']), counts: options.counts.split(',').map(Number), concurrencies: options.concurrency.split(',').map(Number), requests: Number(options.requests), durationSeconds: Number(options['duration-seconds']), batchSize: Number(options['batch-size']), seed: Number(options.seed), samples: Number(options.samples), settleSeconds: Number(options['settle-seconds']), limit: 20, directory: options.directory, resume: options.resume, rerun: options.rerun ?? false, dryRun: options['dry-run'] ?? false };
  if (!['projection', 'full'].includes(config.scope) || (config.scope === 'full' && ![256, 1024].includes(config.bucketCount)) || (config.bucketCount != null && ![256, 1024].includes(config.bucketCount))) throw Error('Choose projection, or full with bucket-count 256 or 1024.');
  config.index = safeIndexName(options.index ?? `color-exploration-favorite-${config.scope}${config.bucketCount ? '-b' + config.bucketCount : ''}-scale-v1`);
  if (!config.counts.length || !config.counts.every((n, i) => Number.isSafeInteger(n) && n > 0 && n <= 1000000 && (i === 0 || n > config.counts[i - 1]))) throw Error('Counts must increase within 1..1000000.');
  if (!config.concurrencies.length || !config.concurrencies.every((n, i) => [1, 4, 16].includes(n) && (i === 0 || n > config.concurrencies[i - 1]))) throw Error('Concurrencies must increase within 1,4,16.');
  if (!Number.isSafeInteger(config.requests) || config.requests < 32 || config.requests > 1000 || !Number.isFinite(config.durationSeconds) || config.durationSeconds < 0 || config.durationSeconds > 60) throw Error('Require 32..1000 requests and 0..60 seconds per block.');
  if (!Number.isSafeInteger(config.batchSize) || config.batchSize < 1 || config.batchSize > 200 || !Number.isSafeInteger(config.seed) || !Number.isSafeInteger(config.samples) || config.samples < 1 || config.samples > 1000 || !Number.isFinite(config.settleSeconds) || config.settleSeconds < 1 || config.settleSeconds > 600) throw Error('Invalid batch size, seed, sample count or settling duration.');
  if (config.directory && config.resume && path.resolve(config.directory) !== path.resolve(config.resume)) throw Error('Directory and resume must identify the same campaign.');
  return config;
}

export function favoriteScaleCases(config = favoriteScaleConfiguration()) {
  return FAVORITE_VARIANTS.filter(variant => config.bucketCount == null || variant.parameters.bucketCount === config.bucketCount).flatMap(variant => FAVORITE_WORKLOAD.map(item => ({ ...variant, ...item, id: variant.id + ':' + item.id, variantId: variant.id, queryId: item.id })));
}

export function validateFavoriteResume({ checkpoint, identity, identityHash, mapping, expectedMapping, actual, nextBatchSize }) {
  if (!checkpoint || checkpoint.identityHash !== identityHash || mapping?._meta?.experiment !== 'strict-hue-favorite-scale' || mapping._meta.identityHash !== identityHash || !same(mapping._meta.identity, identity) || hash(identity) !== identityHash) throw Error('Favorite scale checkpoint/index/source identity mismatch.');
  const { _meta, ...actualMapping } = mapping;
  if (!same(actualMapping, expectedMapping.mappings)) throw Error('Favorite scale mapping differs from frozen inputs.');
  if (!Number.isSafeInteger(checkpoint.nextIndex) || checkpoint.nextIndex < 0 || !Number.isSafeInteger(checkpoint.batchSize) || checkpoint.batchSize < 1 || !Number.isSafeInteger(actual) || actual < checkpoint.nextIndex || actual > checkpoint.nextIndex + checkpoint.batchSize) throw Error('Favorite index count differs from checkpoint or one partial bulk.');
  if (actual > checkpoint.nextIndex && nextBatchSize < checkpoint.batchSize) throw Error('Cannot replay a partial bulk with a smaller batch size.');
  return true;
}

export function remainingFavoriteConcurrencies({ requested, profiles, warmups }) {
  const failed = profiles.filter(profile => !profile.viableAtTestedLoad).map(profile => profile.concurrency);
  const ceiling = failed.length ? Math.min(...failed) : Infinity;
  return requested.filter(value => value < ceiling && !profiles.some(profile => profile.concurrency === value) && (!warmups.some(strictFailure) || value === 1));
}

export function summarizeFavoriteTrials(trials, warmups) {
  if (trials.some((row, ordinal) => row.ordinal !== ordinal || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0)) throw Error('Timed request ordinals must be contiguous and latencies finite.');
  return { ...summarizeTrials(trials, warmups), strictTimedFailures: trials.filter(strictFailure).length, strictWarmupFailures: warmups.filter(strictFailure).length };
}

export function compactFavoriteTrial(row) {
  if (row.phase === 'warmup') { const { hits, ...metrics } = row; return metrics; }
  const { ordinal, elapsedMs, serviceTookMs, hitCount, overOneSecond, error } = row;
  return { ordinal, elapsedMs, ...(serviceTookMs == null ? {} : { serviceTookMs }), hitCount, overOneSecond, ...(error == null ? {} : { error }) };
}

/** Keep files open, batch writes through Node's stream buffer, and bound queued
 * bytes. Timing stops before recording; throughput still includes this work. */
export function createFavoriteRecorder(directory, { highWaterMark = 256 * 1024 } = {}) {
  const files = new Map(); let closed = false, closing, totalRows = 0, totalBytes = 0, peakBufferedBytes = 0, backpressureWaits = 0;
  const check = state => { if (state.failure) throw state.failure; };
  const flush = async () => {
    await Promise.all([...files.values()].map(async state => {
      check(state); if (state.drain) await state.drain;
      await new Promise((resolve, reject) => state.stream.write('', error => error ? reject(error) : resolve())); check(state);
    }));
  };
  return {
    async record(filename, row) {
      if (closed) throw Error('Favorite recorder is closed.');
      if (!['requests.jsonl', 'resources.jsonl'].includes(filename)) throw Error('Unsupported favorite recorder filename.');
      let state = files.get(filename);
      if (!state) {
        const stream = createWriteStream(path.join(directory, filename), { flags: 'a', highWaterMark });
        state = { stream, drain: null, failure: null }; files.set(filename, state);
        stream.on('error', error => { state.failure = error; });
      }
      while (state.drain) { backpressureWaits++; await state.drain; }
      check(state);
      const line = JSON.stringify(row) + '\n', available = state.stream.write(line);
      totalRows++; totalBytes += Buffer.byteLength(line);
      peakBufferedBytes = Math.max(peakBufferedBytes, [...files.values()].reduce((total, file) => total + file.stream.writableLength, 0));
      if (!available) {
        state.drain = once(state.stream, 'drain').then(() => { state.drain = null; }, error => { state.drain = null; throw error; });
        backpressureWaits++; await state.drain;
      }
      check(state);
    },
    flush,
    observation: () => ({ totalRows, totalBytes, peakBufferedBytes, backpressureWaits, streamHighWaterMarkBytes: highWaterMark, openFiles: files.size }),
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        try { await flush(); }
        finally {
          await Promise.all([...files.values()].map(state => new Promise((resolve, reject) => {
            if (state.stream.destroyed) { resolve(); return; }
            state.stream.end(error => error ? reject(error) : resolve());
          })));
        }
      })();
      return closing;
    },
  };
}

async function activity() {
  return (await api('_nodes/stats/thread_pool,indices?filter_path=nodes.*.thread_pool.search,nodes.*.thread_pool.search_throttled,nodes.*.indices.search.query_current,nodes.*.indices.search.fetch_current,nodes.*.indices.merges.current')).body;
}
export async function settleFavoriteActivity({ sample = activity, now = () => performance.now(), sleep = pause, intervalMs = 1000, timeoutMs = 120000, quietSamples = 2 } = {}) {
  const started = now(), samples = []; let consecutive = 0;
  while (true) {
    const snapshot = await sample(), nodes = Object.values(snapshot.nodes ?? {});
    if (!nodes.length || nodes.some(node => !node.thread_pool?.search || !Number.isFinite(node.indices?.merges?.current))) throw Error('Missing node search/merge activity evidence for settling.');
    const pools = nodes.flatMap(node => Object.entries(node.thread_pool).filter(([name]) => name.startsWith('search')).map(([, pool]) => pool));
    const observation = { at: new Date().toISOString(), active: pools.reduce((sum, pool) => sum + (pool.active ?? 0), 0), queued: pools.reduce((sum, pool) => sum + (pool.queue ?? 0), 0), queryCurrent: nodes.reduce((sum, node) => sum + (node.indices.search.query_current ?? 0), 0), fetchCurrent: nodes.reduce((sum, node) => sum + (node.indices.search.fetch_current ?? 0), 0), merges: nodes.reduce((sum, node) => sum + node.indices.merges.current, 0) };
    samples.push(observation);
    consecutive = ['active', 'queued', 'queryCurrent', 'fetchCurrent', 'merges'].every(key => observation[key] === 0) ? consecutive + 1 : 0;
    const elapsedMs = now() - started;
    if (consecutive >= quietSamples) return { settled: true, elapsedMs, quietSamples, samples };
    if (elapsedMs >= timeoutMs) return { settled: false, elapsedMs, quietSamples, samples };
    await sleep(Math.min(intervalMs, timeoutMs - elapsedMs));
  }
}

// Recursively freeze local ESM imports, including parent-directory modules. New
// unrelated experiment files do not silently change a running campaign identity.
export async function favoriteSourceSnapshot(entry = import.meta.url) {
  const files = new Map();
  async function visit(url) {
    const filename = fileURLToPath(url); if (files.has(filename)) return;
    const text = await readFile(filename, 'utf8'); files.set(filename, text);
    const imports = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)].map(match => match[1]);
    for (const imported of imports) if (/\.(?:mjs|js|json)$/.test(imported)) await visit(new URL(imported, url));
  }
  await visit(new URL(entry));
  const root = fileURLToPath(new URL('../', import.meta.url));
  return Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([filename, text]) => [path.relative(root, filename), text]));
}

export function favoriteQueryPlans(cases, fields) {
  return cases.map(item => {
    const targets = resolveCutoffTargets(item.method, item.query, { parameters: item.parameters }).targets;
    const requiredFields = [...new Set(targets.flatMap(target => target.components.flatMap(component => [component.coverageField, component.qualityField])))].sort();
    if (requiredFields.some(field => !fields.includes(field))) throw Error('Favorite scale inputs omit a required query field.');
    const body = buildCutoffQuery({ method: item.method, parameters: item.parameters, query: item.query, filter: item.filter, limit: 20 }); body.timeout = '950ms';
    return { caseId: item.id, requiredFields, body, bodyHash: hash(body), componentCount: body.query.bool.should.length };
  });
}

export async function dryRunFavoriteScale(config = favoriteScaleConfiguration()) {
  const inputs = await loadFavoriteScaleInputs({ scope: config.scope, bucketCount: config.bucketCount });
  const cases = favoriteScaleCases(config), queryPlans = favoriteQueryPlans(cases, inputs.fields);
  return { ...await dryRunFavoriteInputs({ inputs, samples: config.samples, seed: config.seed }), configuration: config, sourceIdentityHash: inputs.identityHash, queryCases: cases.length, maximumProfiles: config.counts.length * cases.length * config.concurrencies.length, queryPlans, limitations: favoriteLimitations(config.scope) };
}

export function favoriteLimitations(scope) {
  return [
    scope === 'projection' ? 'Only workload fields are indexed; this measures query execution, not full-schema storage, memory, indexing or field working-set capacity. Both banks share one field projection.' : 'Full frozen numeric schema and stored source are indexed for one bank; synthetic source structure still limits realism.',
    'Deterministic mixtures of 523 real-wallpaper measurements are performance inputs, not independent photographs or new relevance judgments. Controlled solid-color fixtures are excluded.',
    'request_cache=false; filter/query caches and OS page cache remain uncontrolled. Explicit warmups and repeated anchors favor warm-cache operation.',
    'One shared host, one OpenSearch node, one shard, zero replicas; closed-loop clients self-throttle and do not establish sustained arrival-rate production capacity.',
    'Percentiles use successful timed responses. Errors, slow responses and warmups remain in strict failure accounting. >=1000ms fails; server cancellation is cooperative.',
    'Whole-node cached CPU counters include background activity. One-second heap/RSS samples may miss peaks. Benchmark client CPU includes adapter and recording overhead, not an entire production gateway.',
  ];
}

export async function favoriteResources() {
  return { at: new Date().toISOString(), nodes: (await api('_nodes/stats/os,process,jvm,indices,thread_pool?filter_path=nodes.*.os.cgroup,nodes.*.process.cpu,nodes.*.process.mem,nodes.*.jvm.mem,nodes.*.jvm.gc.collectors,nodes.*.indices.search,nodes.*.indices.merges.current,nodes.*.thread_pool.search')).body.nodes, clientCpu: process.cpuUsage(), clientMemory: process.memoryUsage() };
}
const cpuMs = sample => Object.values(sample.nodes).reduce((sum, node) => sum + (node.process?.cpu?.total_in_millis ?? 0), 0);
const heapBytes = sample => Object.values(sample.nodes ?? {}).reduce((sum, node) => sum + (node.jvm?.mem?.heap_used_in_bytes ?? 0), 0);

export function favoriteCreateBody(documents) {
  return documents.map(document => JSON.stringify({ create: { _id: document.id } }) + '\n' + JSON.stringify(document) + '\n').join('');
}
export function validateFavoriteStoredFields(document, fields) {
  for (const [field, expected] of Object.entries(document)) {
    const actual = fields?.[field];
    const valid = Array.isArray(expected) ? Array.isArray(actual) && same([...actual].sort(), [...expected].sort())
      : actual?.length === 1 && (field.startsWith('quality_') ? Math.fround(actual[0]) === Math.fround(expected) : actual[0] === expected);
    if (!valid) throw Error(`Synthetic indexed value mismatch: ${document.id}/${field}`);
  }
  return true;
}
async function verifyStoredDocuments({ inputs, config, expected }) {
  if (inputs.mapping.mappings._source.enabled) {
    const response = await api(config.index + '/_mget', { method: 'POST', body: { ids: expected.map(document => document.id) } });
    const actual = new Map(response.body.docs.map(document => [document._id, document]));
    for (const document of expected) if (!actual.get(document.id)?.found || !same(actual.get(document.id)._source, document)) throw Error('Full synthetic source mismatch: ' + document.id);
    return;
  }
  const fields = Object.keys(expected[0]), observed = new Map(expected.map(document => [document.id, {}]));
  // OpenSearch limits docvalue_fields to100 by default. Chunk audits instead of
  // changing the index solely for verification convenience.
  for (let offset = 0; offset < fields.length; offset += 100) {
    const response = await api(config.index + '/_search?request_cache=false', { method: 'POST', body: { size: expected.length, _source: false, query: { ids: { values: expected.map(document => document.id) } }, docvalue_fields: fields.slice(offset, offset + 100), sort: [{ id: 'asc' }] } });
    if (response.body.timed_out || response.body._shards?.failed || response.body.hits.hits.length !== expected.length) throw Error('Synthetic value verification returned incomplete results.');
    for (const hit of response.body.hits.hits) {
      if (!observed.has(hit._id)) throw Error('Unexpected synthetic ID during value verification.');
      Object.assign(observed.get(hit._id), hit.fields);
    }
  }
  for (const document of expected) validateFavoriteStoredFields(document, observed.get(document.id));
}
async function createFavoriteBulk({ inputs, config, documents }) {
  const response = await api(config.index + '/_bulk', { method: 'POST', body: favoriteCreateBody(documents), timeoutMs: 300000 });
  if (response.body.items?.length !== documents.length) throw Error('Bulk create returned unexpected operation count.');
  const conflicts = [];
  for (let index = 0; index < documents.length; index++) {
    const item = response.body.items[index].create;
    if (!item || item._id !== documents[index].id) throw Error('Bulk create operation identity differs.');
    if (item.status === 409) conflicts.push(documents[index]);
    else if (item.status !== 201 || item.error) throw Error('Favorite bulk create failed: ' + JSON.stringify(item));
  }
  if (conflicts.length) {
    // Replay can meet the acknowledged portion of a partial bulk. Verify exact
    // existing values before advancing, never silently overwrite those values.
    await api(config.index + '/_refresh', { method: 'POST' });
    await verifyStoredDocuments({ inputs, config, expected: conflicts });
  }
  return { created: documents.length - conflicts.length, verifiedConflicts: conflicts.length };
}
async function verifySyntheticSamples({ inputs, config, count }) {
  const ordinals = [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
  const expected = ordinals.map(index => favoriteSyntheticDocument(inputs.documents, index, { seed: config.seed, coverageFields: inputs.coverageFields }));
  await verifyStoredDocuments({ inputs, config, expected });
  return { count, ordinals, verified: true, fieldsPerDocument: inputs.fields.length, expectedHash: hash(expected), at: new Date().toISOString() };
}

export async function runFavoriteScale(config = favoriteScaleConfiguration()) {
  if (new URL(BASE).port !== '19217') throw Error('Favorite scale requires isolated OpenSearch port 19217.');
  const inputs = await loadFavoriteScaleInputs({ scope: config.scope, bucketCount: config.bucketCount });
  const cases = favoriteScaleCases(config), queryPlans = favoriteQueryPlans(cases, inputs.fields), sourceSnapshot = await favoriteSourceSnapshot();
  const sourceHashes = Object.fromEntries(Object.entries(sourceSnapshot).map(([filename, source]) => [filename, hash(source)]));
  const identity = { experiment: 'strict-hue-favorite-scale', scope: config.scope, bucketCount: config.bucketCount ?? null, sourceIdentityHash: inputs.identityHash, source: inputs.source, fields: inputs.fields, mappingHash: hash(inputs.mapping), seed: config.seed, variants: cases.filter((item, i) => cases.findIndex(other => other.variantId === item.variantId) === i).map(({ variantId, method, parameters }) => ({ id: variantId, method, parameters })), workloadHash: hash(FAVORITE_WORKLOAD), sourceHashes };
  const identityHash = hash(identity), checkpointFile = path.join(STORE, config.index + '.checkpoint.json');
  let checkpoint = await optionalJson(checkpointFile);
  if (checkpoint && checkpoint.identityHash !== identityHash) throw Error('Existing favorite scale source/seed/mapping changed; choose a new scratch index.');
  const directory = path.resolve(config.resume ?? config.directory ?? checkpoint?.directory ?? path.join(STORE, 'favorite-scale', new Date().toISOString().replaceAll(':', '-')));
  if (checkpoint && path.resolve(checkpoint.directory) !== directory) throw Error('Resume must retain the original favorite campaign directory.');
  let result = await optionalJson(path.join(directory, 'scale.json'));
  if (result && (result.identityHash !== identityHash || result.index !== config.index)) throw Error('Favorite campaign artifact identity differs.');
  if (result && !config.rerun && (result.configuration.requests !== config.requests || result.configuration.durationSeconds !== config.durationSeconds)) throw Error('Changed measurement duration/requests require explicit rerun.');
  await mkdir(directory, { recursive: true });
  const sourceFile = path.join(directory, 'source-snapshot.json');
  const previousSnapshot = await optionalJson(sourceFile);
  if (previousSnapshot && !same(previousSnapshot, sourceSnapshot)) throw Error('Frozen campaign source snapshot changed.');
  if (!previousSnapshot) await atomicJson(sourceFile, sourceSnapshot);
  if (!result) {
    result = { schemaVersion: 1, experiment: 'strict-hue-favorite-scale', snapshotId: 'strict-hue-favorite-001', index: config.index, base: BASE, scope: config.scope, fullSchema: config.scope === 'full', startedAt: new Date().toISOString(), identity, identityHash, sourceHashes, sourceSnapshotHash: hash(sourceSnapshot), sourceFile, source: inputs.source, configuration: config, workload: cases, queryPlans, projection: { fields: inputs.fields, fieldCount: inputs.fields.length, fullIndexCapacityMeasured: config.scope === 'full' }, limitations: favoriteLimitations(config.scope), latencyBoundary: 'Compile query through complete decoded OpenSearch response, top20 global ranking. Server950ms/client1500ms. Any error or >=1000ms including case warmup fails the block. Successful-only timed percentiles.', nativeTimeoutMs: 950, clientTimeoutMs: 1500, strictBoundaryMs: 1000, indexing: [], profiles: [], warmups: [], skipped: [], settling: [], sampleAudits: [], indexStats: [], invocations: [] };
  }
  const invocationId = hash({ at: new Date().toISOString(), config, identityHash }).slice(0, 16);
  beginInvocation(result, { id: invocationId, at: new Date().toISOString(), configuration: config, sourceSnapshotHash: hash(sourceSnapshot) });
  const save = () => atomicJson(path.join(directory, 'scale.json'), result);
  const saveCheckpoint = async () => { checkpoint.updatedAt = new Date().toISOString(); await atomicJson(checkpointFile, checkpoint); };
  const recorder = createFavoriteRecorder(directory);
  const record = (filename, row) => recorder.record(filename, row);
  const settle = async context => {
    const observation = await settleFavoriteActivity({ timeoutMs: config.settleSeconds * 1000 }); result.settling.push({ invocationId, ...context, ...observation }); await save();
    if (!observation.settled) throw Error('Search queue or merges did not settle; refusing to contaminate another block.');
  };
  const trial = async (count, item, phase, concurrency, ordinal, context) => {
    const started = performance.now(); let observed;
    try {
      const body = buildCutoffQuery({ method: item.method, parameters: item.parameters, query: item.query, filter: item.filter, limit: config.limit }); body.timeout = '950ms';
      const response = await searchIndex(config.index, body, { timeoutMs: 1500 });
      const elapsedMs = performance.now() - started;
      if (response.hits.length !== Math.min(config.limit, favoriteEligibleCount(count, item))) throw Error('Unexpected global top-hit count for query selectivity.');
      observed = { elapsedMs, serviceTookMs: response.evidence.serviceTookMs, hitCount: response.hits.length, hitsHash: hash(response.hits), ...(phase === 'warmup' ? { hits: response.hits } : {}) };
    } catch (error) { observed = { elapsedMs: performance.now() - started, error: error.message, hitCount: 0 }; }
    const row = { invocationId, count, caseId: item.id, variant: item.variantId, queryId: item.queryId, selectivity: item.selectivity, method: item.method, parameters: item.parameters, phase, concurrency, ordinal, ...context, ...observed, overOneSecond: observed.elapsedMs >= 1000 };
    row.requestId = `${context.profileId ?? context.warmupId}:${phase}:${ordinal}`;
    await record('requests.jsonl', row); return compactFavoriteTrial(row);
  };
  console.log('FAVORITE_SCALE_ARTIFACT ' + path.join(directory, 'scale.json'));
  await save();
  try {
    result.engineVersion = (await api('')).body.version; result.nodeVersion = process.version;
    result.nodeConfiguration = (await api('_nodes/os,jvm,process,thread_pool?filter_path=nodes.*.name,nodes.*.os,nodes.*.jvm.mem.heap_max_in_bytes,nodes.*.process,nodes.*.thread_pool.search')).body;
    let mapping;
    try { mapping = (await api(config.index + '/_mapping')).body[config.index]?.mappings; } catch (error) { if (!/^OpenSearch 404:/.test(error.message)) throw error; }
    if (!mapping) {
      if (checkpoint) throw Error('Checkpoint exists but favorite index is missing; no implicit recreation.');
      const create = structuredClone(inputs.mapping); create.mappings._meta = { experiment: 'strict-hue-favorite-scale', identity, identityHash };
      await api(config.index, { method: 'PUT', body: create });
      checkpoint = { schemaVersion: 1, index: config.index, identity, identityHash, directory, nextIndex: 0, batchSize: config.batchSize, completedStage: 0 }; await saveCheckpoint();
    } else {
      await api(config.index + '/_refresh', { method: 'POST' });
      validateFavoriteResume({ checkpoint, identity, identityHash, mapping, expectedMapping: inputs.mapping, actual: (await api(config.index + '/_count')).body.count, nextBatchSize: config.batchSize });
    }
    checkpoint.batchSize = config.batchSize; await saveCheckpoint();
    const settings = (await api(config.index + '/_settings')).body[config.index]?.settings?.index;
    if (Number(settings?.number_of_shards) !== 1 || Number(settings?.number_of_replicas) !== 0) throw Error('Favorite scale requires one shard and zero replicas.');
    result.indexSettings = settings; await save();
    for (const count of config.counts) {
      if (checkpoint.nextIndex > count) { result.skipped.push({ invocationId, count, reason: 'Index already larger; no result is relabeled as this smaller stage.' }); await save(); continue; }
      if (checkpoint.nextIndex < count) {
        await settle({ count, phase: 'before-indexing' });
        const before = await favoriteResources(), started = performance.now(), from = checkpoint.nextIndex;
        await api(config.index + '/_settings', { method: 'PUT', body: { index: { refresh_interval: '-1' } } });
        while (checkpoint.nextIndex < count) {
          const end = Math.min(count, checkpoint.nextIndex + config.batchSize), documents = [];
          for (let ordinal = checkpoint.nextIndex; ordinal < end; ordinal++) documents.push(favoriteSyntheticDocument(inputs.documents, ordinal, { seed: config.seed, coverageFields: inputs.coverageFields }));
          const bulk = await createFavoriteBulk({ inputs, config, documents });
          if (bulk.verifiedConflicts) { result.bulkReplays ??= []; result.bulkReplays.push({ invocationId, from: checkpoint.nextIndex, to: end, ...bulk }); await save(); }
          checkpoint.nextIndex = end; await saveCheckpoint();
          if (end % 10000 === 0 || end === count) console.log(`Favorite ${config.scope}: indexed ${end}/${count} in ${Math.round((performance.now() - started) / 1000)}s`);
        }
        await api(config.index + '/_refresh', { method: 'POST' });
        const after = await favoriteResources(); result.indexing.push({ invocationId, count, from, indexed: count - from, elapsedMs: performance.now() - started, cpuMs: cpuMs(after) - cpuMs(before), before, after });
        checkpoint.completedStage = count; await saveCheckpoint(); await save();
      }
      if ((await api(config.index + '/_count')).body.count !== count) throw Error('Favorite index count changed before timing.');
      await settle({ count, phase: 'after-indexing' });
      result.sampleAudits.push(await verifySyntheticSamples({ inputs, config, count }));
      result.indexStats.push({ invocationId, count, at: new Date().toISOString(), stats: (await api(config.index + '/_stats/store,docs,segments,merge')).body._all }); await save();
      // Rotate which bank begins each stage, while every block remains one exact query.
      const ordered = count === config.counts[0] ? cases : [...cases].reverse();
      for (const item of ordered) {
        const prior = config.rerun ? [] : result.profiles.filter(profile => profile.count === count && profile.caseId === item.id);
        const priorWarmups = config.rerun ? [] : result.warmups.filter(group => group.count === count && group.caseId === item.id).flatMap(group => group.trials);
        if (!remainingFavoriteConcurrencies({ requested: config.concurrencies, profiles: prior, warmups: priorWarmups }).length) continue;
        await settle({ count, caseId: item.id, phase: 'before-warmup' });
        const warmupId = `${invocationId}:${count}:${item.id}:warmup`, warmups = [await trial(count, item, 'warmup', 1, 0, { warmupId })];
        result.warmups.push({ id: warmupId, invocationId, count, caseId: item.id, trials: warmups }); await recorder.flush(); await save();
        const caseWarmups = [...priorWarmups, ...warmups];
        const allowed = remainingFavoriteConcurrencies({ requested: config.concurrencies, profiles: prior, warmups: caseWarmups });
        for (const concurrency of allowed) {
          await settle({ count, caseId: item.id, concurrency, phase: 'before-profile' });
          const profileId = `${invocationId}:${count}:${item.id}:c${concurrency}`, before = await favoriteResources(), samples = [before];
          let sampling = false, stopped = false, pendingSample = Promise.resolve();
          const timer = setInterval(() => {
            if (sampling || stopped) return; sampling = true;
            pendingSample = favoriteResources().then(async sample => { samples.push(sample); await record('resources.jsonl', { invocationId, profileId, ...sample }); }).catch(async error => { const sample = { at: new Date().toISOString(), error: error.message }; samples.push(sample); await record('resources.jsonl', { invocationId, profileId, ...sample }); }).finally(() => { sampling = false; });
          }, 1000);
          let measurement;
          try { measurement = await runWorkload({ items: [item], concurrency, repetitions: config.requests, durationMs: config.durationSeconds * 1000, trial: (_, ordinal) => trial(count, item, 'timed', concurrency, ordinal, { profileId, warmupId }) }); }
          finally { stopped = true; clearInterval(timer); await pendingSample; }
          const after = await favoriteResources(); samples.push(after);
          const profile = { id: profileId, invocationId, warmupId, count, caseId: item.id, variant: item.variantId, queryId: item.queryId, selectivity: item.selectivity, method: item.method, parameters: item.parameters, index: config.index, scope: config.scope, concurrency, effectiveConcurrency: Math.min(concurrency, config.requests), elapsedMs: measurement.elapsedMs, minimumRequests: config.requests, requestedDurationMs: config.durationSeconds * 1000, measurement: 'closed-loop-single-query-favorite', ...summarizeFavoriteTrials(measurement.trials, warmups), throughputPerSecond: measurement.trials.length / (measurement.elapsedMs / 1000), cpuMs: cpuMs(after) - cpuMs(before), clientCpuMs: (after.clientCpu.user + after.clientCpu.system - before.clientCpu.user - before.clientCpu.system) / 1000, peakObservedHeapBytes: Math.max(...samples.map(heapBytes)), peakObservedClientRssBytes: Math.max(...samples.map(sample => sample.clientMemory?.rss ?? 0)), resourceSampleCount: samples.length, resourceErrors: samples.filter(sample => sample.error).length, before, after, trials: measurement.trials };
          Object.assign(profile, summarizeFavoriteTrials(measurement.trials, caseWarmups));
          profile.warmupIds = [...new Set(caseWarmups.map(row => row.warmupId))];
          result.profiles.push(profile); await recorder.flush(); result.recording = recorder.observation(); await save();
          console.log(JSON.stringify({ ...profile, before: undefined, after: undefined, trials: undefined }));
          await settle({ count, caseId: item.id, profileId, phase: 'after-profile' });
          if (!profile.viableAtTestedLoad) break;
        }
        const completed = result.profiles.filter(profile => profile.invocationId === invocationId && profile.count === count && profile.caseId === item.id);
        const skippedConcurrencies = config.concurrencies.filter(concurrency => ![...prior, ...completed].some(profile => profile.concurrency === concurrency));
        if (skippedConcurrencies.length) { result.skipped.push({ invocationId, count, caseId: item.id, concurrencies: skippedConcurrencies, warmupId, reason: 'This case failed strict viability, including its warmup; higher load omitted.' }); await save(); }
      }
    }
    await recorder.flush(); await settle({ phase: 'after-campaign' });
    if (hash(await favoriteSourceSnapshot()) !== hash(sourceSnapshot)) throw Error('Campaign source changed during measurement.');
    result.finalIndexStats = (await api(config.index + '/_stats/store,docs,segments,merge')).body._all;
    result.finishedAt = new Date().toISOString(); result.invocations.at(-1).finishedAt = result.finishedAt; result.recording = recorder.observation(); await recorder.close(); await save();
    return { directory, result };
  } catch (error) {
    try { await recorder.close(); } catch (recordingError) { result.recordingError = recordingError.message; }
    result.recording = recorder.observation(); result.interruptions ??= []; result.interruptions.push({ invocationId, at: new Date().toISOString(), error: error.stack ?? String(error), nextIndex: checkpoint?.nextIndex }); await save(); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = favoriteScaleConfiguration(process.argv.slice(2));
  if (config.dryRun) console.log(JSON.stringify(await dryRunFavoriteScale(config), null, 2));
  else await runFavoriteScale(config);
}
