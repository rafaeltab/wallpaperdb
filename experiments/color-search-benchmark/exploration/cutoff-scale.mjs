// QUERY-FIELD PROJECTION ONLY: native query work, not full cutoff-index capacity.
import { mkdir, readFile, writeFile, rename, appendFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUTOFF_LEVELS, CUTOFF_PROFILES } from './cutoff-definition.mjs';
import { OVERLAP_BUCKET_COUNTS } from './overlap-banks.mjs';
import { CUTOFF_METHODS, resolveCutoffTargets, buildCutoffQuery } from './methods-cutoff.mjs';
import { syntheticOverlapDocument, OVERLAP_SYNTHETIC_PROVENANCE } from './overlap-scale-corpus.mjs';
import { runWorkload, summarizeTrials, beginInvocation } from './rank-features-scale.mjs';
import { settleSearchQueue } from './arrival-load.mjs';
import { validateGridScaleConfiguration, validateGridScaleResume } from './precision-grid-scale.mjs';
import { api, BASE, STORE, safeIndexName, bulkIndex, searchIndex, hash, loadExpandedCorpus } from './service.mjs';

export const CUTOFF_SCALE_INDEX = 'color-exploration-cutoff-projection-scale-v1';
export const CUTOFF_SCALE_LIMITATIONS = Object.freeze([
  'QUERY-FIELD PROJECTION: only fields required by this fixed workload are indexed. This measures native query work at the tested document counts, not the storage, memory, indexing cost or cache pressure of the full 30,720-color-field schema.',
  'All bucket counts query the same union-of-fields index. Differences measure selected anchors and query construction, not separate full physical indexes for each bucket count.',
  ...OVERLAP_SYNTHETIC_PROVENANCE.limitations,
  'Short closed-loop C1/C4/C16 profiles on one shared host are diagnostic evidence, not a sustained arrival-rate or production capacity guarantee.',
  'Synthetic tags and partitions have deterministic 1%/10% selectivity and are not inherited subject judgments.',
]);
const SOURCE_FILES = ['cutoff-scale.mjs', 'cutoff-definition.mjs', 'cutoff-index.mjs', 'methods-cutoff.mjs', 'methods-overlap.mjs', 'overlap-scale-corpus.mjs', 'overlap-regions.mjs', 'overlap-banks.mjs', 'overlap-index.mjs', 'corpus-colors.mjs', 'query.mjs', 'service.mjs', 'rank-features-scale.mjs', 'precision-grid-scale.mjs', 'arrival-load.mjs', '../ranges.mjs', '../proportions.mjs'];
const rawWorkload = [
  { id: 'picked-one-vibe', query: { mode: 'vibe', targets: [{ color: '#ff2200' }] } },
  { id: 'picked-one-green40', query: { mode: 'proportions', targets: [{ color: '#22cc44', percent: 40 }] } },
  { id: 'picked-two-portions', query: { mode: 'proportions', targets: [{ color: '#ff2200', percent: 50 }, { color: '#22cc44', percent: 50 }] } },
  { id: 'picked-five-portions', query: { mode: 'proportions', targets: ['#ff2200', '#ff8800', '#ffff00', '#22cc44', '#2266ff'].map(color => ({ color, percent: 20 })) } },
];
export const CUTOFF_SCALE_WORKLOAD = Object.freeze(rawWorkload.flatMap(item => [
  { ...item, selectivity: 'all' },
  { ...item, id: item.id + '-partition10', selectivity: 'partition10', filter: { range: { partition: { lt: 10 } } } },
  { ...item, id: item.id + '-tag1', selectivity: 'tag1', filter: { term: { tags: 'synthetic-one-percent' } } },
]));

export function cutoffScaleConfiguration(args = []) {
  const defaults = { index: CUTOFF_SCALE_INDEX, counts: '100000,1000000', concurrency: '1,4,16', repeats: '2', 'duration-seconds': '0', 'batch-size': '200', seed: '99539473', limit: '20', 'merge-wait-seconds': '60', 'bucket-counts': '16,64,256,1024', profiles: 'hard,feather,core-halo,consensus', cutoffs: '0.5,0', 'request-timeout-ms': '1500', samples: '100' };
  const options = { ...defaults }, flags = new Set(['--rerun', '--dry-run']);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flags.has(flag)) { options[flag.slice(2)] = true; continue; }
    const key = flag.slice(2);
    if (!flag.startsWith('--') || !(key in defaults || ['resume', 'directory'].includes(key))) throw Error('Unknown cutoff scale option: ' + flag);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw Error('Missing option value for ' + flag);
    options[key] = value;
  }
  return validateCutoffScaleConfiguration({
    index: options.index, counts: options.counts.split(',').map(Number), concurrencies: options.concurrency.split(',').map(Number),
    repetitions: Number(options.repeats), durationSeconds: Number(options['duration-seconds']), batchSize: Number(options['batch-size']), seed: Number(options.seed),
    resume: options.resume, directory: options.directory, rerun: options.rerun ?? false, dryRun: options['dry-run'] ?? false,
    limit: Number(options.limit), mergeWaitSeconds: Number(options['merge-wait-seconds']), bucketCounts: options['bucket-counts'].split(',').map(Number),
    profiles: options.profiles.split(','), cutoffs: options.cutoffs.split(',').map(Number), requestTimeoutMs: Number(options['request-timeout-ms']), samples: Number(options.samples),
  });
}
export function validateCutoffScaleConfiguration(config) {
  validateGridScaleConfiguration(config);
  for (const [name, allowed] of [['bucketCounts', OVERLAP_BUCKET_COUNTS], ['profiles', CUTOFF_PROFILES.map(item => item.id)], ['cutoffs', CUTOFF_LEVELS.map(item => item.cutoff)]]) {
    const values = config[name];
    if (!Array.isArray(values) || !values.length || new Set(values).size !== values.length || values.some(value => !allowed.includes(value))) throw Error('Invalid cutoff scale ' + name);
  }
  if (config.repetitions > 20 || config.durationSeconds > 60) throw Error('This bounded campaign accepts at most 20 repetitions or 60 seconds per profile.');
  if (!Number.isSafeInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1000 || config.requestTimeoutMs > 5000) throw Error('Client timeout must be 1000..5000ms; strict viability remains below 1000ms.');
  if (!Number.isSafeInteger(config.samples) || config.samples < 1 || config.samples > 10000) throw Error('Dry-run samples must be 1..10000.');
  return config;
}
export function cutoffScaleVariants(config) {
  return config.profiles.flatMap(profile => config.bucketCounts.flatMap(bucketCount => config.cutoffs.map(pixelCutoff => ({
    id: `${profile}-b${bucketCount}-q${Math.round(pixelCutoff * 100)}`, profile,
    method: CUTOFF_METHODS.find(method => method.profile === profile).id,
    parameters: { bucketCount, pixelCutoff },
  }))));
}
export function cutoffProjectionFields(variants, workload = CUTOFF_SCALE_WORKLOAD) {
  const fields = new Set();
  for (const variant of variants) for (const item of workload) {
    const resolved = resolveCutoffTargets(variant.method, item.query, { parameters: variant.parameters });
    for (const target of resolved.targets) for (const component of target.components) {
      fields.add(component.coverageField); fields.add(component.qualityField);
      fields.add(component.physicalCoverageField);
      fields.add('quality_' + component.physicalCoverageField.slice(4));
    }
  }
  return [...fields].sort();
}
export function cutoffProjectionMapping(fields) {
  const properties = { id: { type: 'keyword' }, reference_id: { type: 'keyword' }, cohort: { type: 'keyword' }, partition: { type: 'integer' }, tags: { type: 'keyword' } };
  for (const field of fields) {
    if (!/^(cov|quality)_o\d{4}_(hard|feather|core_halo)_q(00|25|50|75|90)$/.test(field)) throw Error('Unexpected cutoff projection field: ' + field);
    properties[field] = { type: field.startsWith('cov_') ? 'integer' : 'float' };
  }
  return { settings: { number_of_shards: 1, number_of_replicas: 0, refresh_interval: '-1', 'index.mapping.total_fields.limit': Object.keys(properties).length + 20 }, mappings: { dynamic: 'strict', _source: { enabled: false }, properties } };
}
export function projectCutoffDocument(document, fields) {
  if (typeof document.id !== 'string' || !document.id) throw Error('Missing source document ID.');
  const result = { id: document.id, reference_id: document.reference_id ?? document.id, cohort: document.cohort ?? 'real', partition: document.partition ?? 0, tags: document.tags ?? [] };
  for (const field of fields) {
    const value = document[field], coverage = field.startsWith('cov_');
    if (!Number.isFinite(value) || value < 0 || value > (coverage ? 10000 : 1) || (coverage && !Number.isInteger(value))) throw Error('Missing or invalid projected measurement: ' + field);
    result[field] = value;
  }
  return result;
}
export function syntheticCutoffProjection(documents, index, options = {}) {
  const result = syntheticOverlapDocument(documents, index, options);
  result.id = `cutoff-projection-synthetic-${String(index).padStart(9, '0')}`;
  result.tags = ['synthetic-all', ...(result.partition < 10 ? ['synthetic-ten-percent'] : []), ...(result.partition === 1 ? ['synthetic-one-percent'] : [])];
  return result;
}
export function cutoffEligibleCount(count, item) {
  if (item.selectivity === 'partition10') return Math.floor(count / 100) * 10 + Math.min(10, count % 100);
  if (item.selectivity === 'tag1') return Math.floor(count / 100) + Number(count % 100 > 1);
  return count;
}

const optionalJson = async filename => { try { return JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; } };
const atomicJson = async (filename, value) => { await writeFile(filename + '.tmp', JSON.stringify(value, null, 2)); await rename(filename + '.tmp', filename); };
const sortedIds = items => items.map(item => item.id).sort();
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function validateCutoffProjectionResume({ checkpoint, metadata, identityHash, actual, nextBatchSize, existingMapping, expectedMapping }) {
  if (hash(canonical(existingMapping?.properties)) !== hash(canonical(expectedMapping?.properties)) || existingMapping?.dynamic !== 'strict' || existingMapping?._source?.enabled !== false || metadata?.fullIndexCapacityMeasured !== false) throw Error('Existing projection mapping differs; refusing to overwrite.');
  return validateGridScaleResume({ checkpoint, metadata, identityHash, actual, nextBatchSize });
}
async function loadVerifiedProjection(fields) {
  // Read one full measured descriptor at a time. Its complete document hash must
  // reproduce the receipt from the all-values verification of the real index.
  const { CUTOFF_SOURCE_FILES, toCutoffDocument, verifyHard50Parity } = await import('./cutoff-index.mjs');
  const { loadOverlapDocuments } = await import('./overlap-index.mjs');
  const receipt = await optionalJson(path.join(STORE, 'color-exploration-cutoff-1024-real-v1.json'));
  if (!receipt?.completeIdsVerified || !receipt.allValuesVerified || !receipt.hard50ParityVerified || receipt.count !== 545) throw Error('Complete all-values-verified 545-wallpaper cutoff index receipt is required.');
  const metadata = JSON.parse(await readFile(path.join(receipt.directory, 'metadata.json'), 'utf8'));
  if (hash(metadata.identity) !== receipt.identityHash || metadata.identityHash !== receipt.identityHash || hash(metadata.assets) !== receipt.descriptorHash || metadata.descriptorHash !== receipt.descriptorHash) throw Error('Cutoff source manifest identity differs from verification receipt.');
  for (const name of CUTOFF_SOURCE_FILES) {
    const expected = metadata.identity.sourceHashes[name];
    if (!expected || expected !== receipt.sourceHashes[name] || hash(await readFile(new URL(name, import.meta.url))) !== expected || hash(await readFile(path.join(receipt.directory, 'sources', name))) !== expected) throw Error('Cutoff measured-source fingerprint changed: ' + name);
  }
  const corpus = await loadExpandedCorpus(), originals = new Map((await loadOverlapDocuments()).map(document => [document.id, document]));
  if (corpus.length !== 545 || originals.size !== 545 || metadata.count !== 545 || new Set(sortedIds(corpus)).size !== 545 || hash(sortedIds(corpus)) !== hash(sortedIds(metadata.assets))) throw Error('Cutoff projection requires the same complete 545-asset corpus.');
  const records = new Map(metadata.assets.map(asset => [asset.id, asset])), documents = [], valueHashes = [];
  for (const asset of corpus) {
    const record = records.get(asset.id);
    const bytes = await readFile(path.join(receipt.directory, 'descriptors', hash(asset.id).slice(0, 32) + '.json'));
    if (hash(bytes) !== record.descriptorHash) throw Error('Cutoff measured descriptor hash mismatch: ' + asset.id);
    const saved = JSON.parse(bytes);
    if (saved.id !== asset.id || saved.sha256 !== asset.sha256 || record.sha256 !== asset.sha256 || saved.identityHash !== receipt.identityHash) throw Error('Cutoff source asset identity mismatch: ' + asset.id);
    const original = originals.get(asset.id);
    if (!original) throw Error('Original measured wallpaper missing: ' + asset.id);
    verifyHard50Parity(saved.descriptor, original);
    const complete = toCutoffDocument(original, saved.descriptor, 1024);
    valueHashes.push({ id: complete.id, hash: hash(complete) });
    documents.push(projectCutoffDocument(complete, fields));
  }
  if (hash(valueHashes) !== receipt.valuesHash) throw Error('Measured documents differ from the all-values-verified real index.');
  return { documents, source: { receiptFile: path.join(STORE, 'color-exploration-cutoff-1024-real-v1.json'), sourceDirectory: receipt.directory, identityHash: receipt.identityHash, descriptorHash: receipt.descriptorHash, valuesHash: receipt.valuesHash, allValuesVerified: true, sourceIdsHash: hash(sortedIds(corpus)), projectedDocumentsHash: hash(documents) } };
}

const cpuMs = sample => Object.values(sample?.nodes ?? {}).reduce((sum, node) => sum + (node.process?.cpu?.total_in_millis ?? 0), 0);
const heapBytes = sample => Object.values(sample?.nodes ?? {}).reduce((sum, node) => sum + (node.jvm?.mem?.heap_used_in_bytes ?? 0), 0);
async function resources() {
  const response = await api('_nodes/stats/process,jvm,indices,thread_pool?filter_path=nodes.*.process.cpu.total_in_millis,nodes.*.jvm.mem,nodes.*.jvm.gc.collectors,nodes.*.indices.search,nodes.*.indices.merges.current,nodes.*.thread_pool.search');
  return { at: new Date().toISOString(), nodes: response.body.nodes, serviceMemory: process.memoryUsage(), serviceCpu: process.cpuUsage() };
}
async function settleMerges(index, seconds) {
  const started = performance.now();
  while (true) {
    const current = (await api(index + '/_stats/merge')).body._all?.total?.merges?.current;
    if (current === 0 || performance.now() - started >= seconds * 1000) return { elapsedMs: performance.now() - started, settled: current === 0, current };
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
export async function dryRunCutoffScale(configuration = {}) {
  const config = validateCutoffScaleConfiguration({ ...cutoffScaleConfiguration(), ...configuration });
  const variants = cutoffScaleVariants(config), fields = cutoffProjectionFields(variants), { documents, source } = await loadVerifiedProjection(fields);
  const coverageFields = fields.filter(field => field.startsWith('cov_')), started = performance.now();
  let bytes = 0;
  for (let index = 0; index < config.samples; index++) bytes += Buffer.byteLength(JSON.stringify(syntheticCutoffProjection(documents, index, { seed: config.seed, coverageFields })));
  return { dryRun: true, noServiceRequests: true, source, variants: variants.length, queriesPerVariant: CUTOFF_SCALE_WORKLOAD.length, projectionFields: fields.length, fields, samples: config.samples, elapsedMs: performance.now() - started, meanSerializedDocumentBytes: bytes / config.samples, limitations: CUTOFF_SCALE_LIMITATIONS };
}

export async function runCutoffScale(configuration = {}) {
  const config = validateCutoffScaleConfiguration({ ...cutoffScaleConfiguration(), ...configuration });
  safeIndexName(config.index);
  if (new URL(BASE).port !== '19217') throw Error('Cutoff scale requires isolated OpenSearch port19217.');
  const variants = cutoffScaleVariants(config), fields = cutoffProjectionFields(variants), coverageFields = fields.filter(field => field.startsWith('cov_'));
  const { documents, source } = await loadVerifiedProjection(fields), mapping = cutoffProjectionMapping(fields);
  const sourceHashes = Object.fromEntries(await Promise.all(SOURCE_FILES.map(async name => [name, hash(await readFile(new URL(name, import.meta.url)))])));
  const identity = { source, fields, mappingHash: hash(mapping), generatorHash: sourceHashes['overlap-scale-corpus.mjs'], computationHashes: sourceHashes, variants, workloadHash: hash(CUTOFF_SCALE_WORKLOAD), seed: config.seed, kind: 'query-field-projection-only' }, identityHash = hash(identity);
  const checkpointFile = path.join(STORE, config.index + '.checkpoint.json');
  let checkpoint = await optionalJson(checkpointFile);
  if (checkpoint && checkpoint.identityHash !== identityHash) throw Error('Cutoff projection/source identity changed; choose a new scratch index.');
  const directory = config.resume ?? config.directory ?? checkpoint?.directory ?? path.join(STORE, 'cutoff-scale', new Date().toISOString().replaceAll(':', '-'));
  const sourceDirectory = path.join(directory, 'sources', hash(sourceHashes).slice(0, 16), 'exploration');
  await mkdir(sourceDirectory, { recursive: true });
  for (const name of SOURCE_FILES) await copyFile(fileURLToPath(new URL(name, import.meta.url)), path.join(sourceDirectory, name));
  let result = await optionalJson(path.join(directory, 'scale.json'));
  if (result && (result.identityHash !== identityHash || result.index !== config.index)) throw Error('Cutoff scale resume artifact identity mismatch.');
  result ??= { schemaVersion: 1, experiment: 'cutoff-query-field-projection', index: config.index, base: BASE, startedAt: new Date().toISOString(), identity, identityHash, configuration: config, sourceHashes, sourceDirectory, variants, workload: CUTOFF_SCALE_WORKLOAD,
    corpus: { ...OVERLAP_SYNTHETIC_PROVENANCE, sourceAssets: 545, realPhotographs: 523, controlledFixtures: 22 }, projection: { fields, fieldCount: fields.length, fullColorFieldCount: 30720, fullIndexCapacityMeasured: false }, limitations: CUTOFF_SCALE_LIMITATIONS,
    latencyBoundary: 'Query compilation through complete decoded OpenSearch response; any error or >=1000ms including warmups fails strict viability. Server timeout950ms; partial hits rejected. Percentiles contain successful timed requests only.',
    indexing: [], warmups: [], profiles: [], skippedStages: [], settling: [], invocations: [] };
  const invocationId = hash({ at: new Date().toISOString(), config, sourceHashes }).slice(0, 16);
  beginInvocation(result, { id: invocationId, at: new Date().toISOString(), configuration: config, sourceHashes, sourceDirectory });
  result.version = (await api('')).body.version;
  result.nodeVersion = process.version;
  result.nodeConfiguration = (await api('_nodes/os,jvm,process?filter_path=nodes.*.name,nodes.*.os.allocated_processors,nodes.*.os.available_processors,nodes.*.jvm.mem.heap_max_in_bytes,nodes.*.process')).body;
  const save = () => atomicJson(path.join(directory, 'scale.json'), result);
  let pendingWrites = Promise.resolve();
  const record = (filename, value) => { pendingWrites = pendingWrites.then(() => appendFile(path.join(directory, filename), JSON.stringify(value) + '\n')); };
  const saveCheckpoint = async () => { checkpoint.updatedAt = new Date().toISOString(); await atomicJson(checkpointFile, checkpoint); };
  let existing;
  try { existing = (await api(config.index + '/_mapping')).body[config.index]?.mappings; } catch (error) { if (!error.message.startsWith('OpenSearch 404:')) throw error; }
  if (!existing) {
    if (checkpoint) throw Error('Checkpoint exists but projection index is missing; refusing implicit recreation.');
    mapping.mappings._meta = { experiment: 'cutoff-query-field-projection', identityHash, identity, fullIndexCapacityMeasured: false };
    await api(config.index, { method: 'PUT', body: mapping });
    checkpoint = { schemaVersion: 1, index: config.index, identityHash, directory, nextIndex: 0, completedStage: 0, batchSize: config.batchSize };
  } else {
    await api(config.index + '/_refresh', { method: 'POST' });
    validateCutoffProjectionResume({ checkpoint, metadata: existing._meta, identityHash, actual: (await api(config.index + '/_count')).body.count, nextBatchSize: config.batchSize, existingMapping: existing, expectedMapping: mapping.mappings });
  }
  checkpoint.batchSize = config.batchSize; checkpoint.directory = directory;
  await saveCheckpoint(); await save();
  console.log('CUTOFF_PROJECTION_SCALE_ARTIFACT ' + path.join(directory, 'scale.json'));
  const settle = async context => { const observation = await settleSearchQueue(); result.settling.push({ ...context, ...observation }); await save(); if (!observation.settled) throw Error('Search queue did not settle; refusing another profile.'); };
  const trial = async (variant, count, item, phase, concurrency, context = {}) => {
    const started = performance.now(); let row;
    try {
      const body = buildCutoffQuery({ method: variant.method, parameters: variant.parameters, query: item.query, filter: item.filter, limit: config.limit });
      body.timeout = '950ms';
      const response = await searchIndex(config.index, body, { timeoutMs: config.requestTimeoutMs }), elapsedMs = performance.now() - started;
      const expected = Math.min(config.limit, cutoffEligibleCount(count, item));
      if (response.hits.length !== expected) throw Error(`Expected ${expected} globally ranked hits; received ${response.hits.length}.`);
      row = { elapsedMs, serviceTookMs: response.evidence.serviceTookMs, hits: response.hits, overOneSecond: elapsedMs >= 1000 };
    } catch (error) { const elapsedMs = performance.now() - started; row = { elapsedMs, error: error.message, overOneSecond: elapsedMs >= 1000 }; }
    row = { invocationId, ...context, variant: variant.id, method: variant.method, parameters: variant.parameters, count, queryId: item.id, selectivity: item.selectivity, phase, concurrency, ...row };
    record('requests.jsonl', row); const { hits, ...metrics } = row; return { ...metrics, hitCount: hits?.length ?? 0 };
  };
  try {
    await settle({ phase: 'before-campaign' });
    for (const count of config.counts) {
      if (checkpoint.nextIndex > count) { result.skippedStages.push({ count, actualAtLeast: checkpoint.nextIndex, reason: 'Existing index is larger; no smaller measurement claimed.' }); await save(); continue; }
      if (checkpoint.nextIndex < count) {
        const before = await resources(), started = performance.now(), from = checkpoint.nextIndex;
        await api(config.index + '/_settings', { method: 'PUT', body: { index: { refresh_interval: '-1' } } });
        while (checkpoint.nextIndex < count) {
          const end = Math.min(count, checkpoint.nextIndex + config.batchSize), batch = [];
          for (let index = checkpoint.nextIndex; index < end; index++) batch.push(syntheticCutoffProjection(documents, index, { seed: config.seed, coverageFields }));
          await bulkIndex(config.index, batch); checkpoint.nextIndex = end; await saveCheckpoint();
          if (end % 10000 === 0 || end === count) console.log(`Indexed ${end}/${count} query-field projection documents in ${Math.round((performance.now() - started) / 1000)}s`);
        }
        await api(config.index + '/_refresh', { method: 'POST' });
        const after = await resources(); result.indexing.push({ count, from, indexed: count - from, elapsedMs: performance.now() - started, cpuMs: cpuMs(after) - cpuMs(before), before, after, fullIndexCapacityMeasured: false });
        checkpoint.completedStage = count; await saveCheckpoint(); await save();
      }
      if ((await api(config.index + '/_count')).body.count !== count) throw Error('Projection document count mismatch.');
      result.lastMergeStatus = { count, ...await settleMerges(config.index, config.mergeWaitSeconds) };
      result.indexStats ??= []; result.indexStats.push({ count, at: new Date().toISOString(), fullIndexCapacityMeasured: false, stats: (await api(config.index + '/_stats/store,docs,segments')).body._all }); await save();
      for (const variant of variants) {
        const existingProfiles = result.profiles.filter(profile => profile.variant === variant.id && profile.count === count);
        if (!config.rerun && existingProfiles.some(profile => !profile.viableAtTestedLoad)) continue;
        if (!config.rerun && config.concurrencies.every(concurrency => existingProfiles.some(profile => profile.concurrency === concurrency))) continue;
        await settle({ count, variant: variant.id, phase: 'before-warmup' });
        const warmupId = `${invocationId}:${count}:${variant.id}`, warmups = [];
        for (const item of CUTOFF_SCALE_WORKLOAD) warmups.push(await trial(variant, count, item, 'warmup', 1, { warmupId }));
        result.warmups.push({ id: warmupId, invocationId, count, variant: variant.id, trials: warmups }); await pendingWrites; await save();
        if (warmups.some(row => row.error || row.elapsedMs >= 1000)) await settle({ count, variant: variant.id, phase: 'after-failed-warmup' });
        for (const concurrency of config.concurrencies) {
          if (!config.rerun && existingProfiles.some(profile => profile.concurrency === concurrency)) continue;
          const before = await resources(), samples = [before], profileId = `${warmupId}:c${concurrency}`;
          let sampling = false, stopped = false, pendingSample = Promise.resolve();
          const timer = setInterval(() => { if (sampling || stopped) return; sampling = true; pendingSample = resources().then(sample => { samples.push(sample); record('resources.jsonl', { count, variant: variant.id, concurrency, ...sample }); }).catch(error => samples.push({ error: error.message })).finally(() => { sampling = false; }); }, 1000);
          let measurement;
          try { measurement = await runWorkload({ items: CUTOFF_SCALE_WORKLOAD, concurrency, repetitions: config.repetitions, durationMs: config.durationSeconds * 1000, trial: (item, ordinal) => trial(variant, count, item, 'timed', concurrency, { profileId, warmupId, ordinal }) }); }
          finally { stopped = true; clearInterval(timer); await pendingSample; }
          const { trials, elapsedMs, minimumRequests, durationMs } = measurement, after = await resources(); samples.push(after);
          const profile = { id: profileId, invocationId, warmupId, variant: variant.id, method: variant.method, parameters: variant.parameters, index: config.index, count, concurrency, effectiveConcurrency: Math.min(concurrency, minimumRequests), elapsedMs, minimumRequests, requestedDurationMs: durationMs, measurement: 'closed-loop-query-field-projection',
            ...summarizeTrials(trials, warmups), throughputPerSecond: trials.length / (elapsedMs / 1000), cpuMs: cpuMs(after) - cpuMs(before), serviceCpuMs: ((after.serviceCpu.user - before.serviceCpu.user) + (after.serviceCpu.system - before.serviceCpu.system)) / 1000,
            peakObservedHeapBytes: Math.max(...samples.map(heapBytes)), peakObservedServiceRssBytes: Math.max(...samples.map(sample => sample.serviceMemory?.rss ?? 0)), resourceSampleCount: samples.length, before, after, trials,
            fullIndexCapacityMeasured: false, resourceLimitations: 'Projection only. Whole-node CPU includes background activity; memory sampled once/second plus boundaries. Brief closed-loop measurements do not establish sustained production concurrency.' };
          result.profiles.push(profile); await pendingWrites; await save(); console.log(JSON.stringify({ ...profile, before: undefined, after: undefined, trials: undefined }));
          if (!profile.viableAtTestedLoad) { result.skippedStages.push({ count, variant: variant.id, concurrencies: config.concurrencies.filter(value => value > concurrency), reason: 'Strict one-second criterion failed; higher concurrency skipped.' }); await save(); await settle({ count, profileId, phase: 'after-failed-profile' }); break; }
        }
      }
    }
    await pendingWrites; await settle({ phase: 'after-campaign' });
    result.finishedAt = new Date().toISOString(); result.invocations.at(-1).finishedAt = result.finishedAt; await save();
    return { directory, result };
  } catch (error) {
    await pendingWrites; result.interruptions ??= []; result.interruptions.push({ at: new Date().toISOString(), error: error.stack ?? String(error), nextIndex: checkpoint.nextIndex }); await save(); throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const supplied = cutoffScaleConfiguration(process.argv.slice(2));
  if (supplied.dryRun) console.log(JSON.stringify(await dryRunCutoffScale(supplied), null, 2));
  else await runCutoffScale(supplied);
}
