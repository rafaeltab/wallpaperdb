// Comparison harness only: query builders compile locally; OpenSearch ranks globally.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { FAVORITE_WORKLOAD, favoriteEligibleCount } from './favorite-scale-corpus.mjs';
import { runWorkload } from './rank-features-scale.mjs';
import { createFavoriteRecorder, compactFavoriteTrial, summarizeFavoriteTrials, settleFavoriteActivity, favoriteResources, favoriteSourceSnapshot } from './favorite-scale.mjs';
import { BASE, api, searchIndex, safeIndexName, hash } from './service.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => hash(canonical(a)) === hash(canonical(b));
const failed = row => Boolean(row.error) || !Number.isFinite(row.elapsedMs) || row.elapsedMs >= 1000;
const atomicJson = async (file, value) => { await writeFile(file + '.tmp', JSON.stringify(value, null, 2)); await rename(file + '.tmp', file); };
const cpuMs = sample => Object.values(sample.nodes ?? {}).reduce((sum, node) => sum + (node.process?.cpu?.total_in_millis ?? 0), 0);
const heapBytes = sample => sample.nodes ? Object.values(sample.nodes).reduce((sum, node) => sum + (node.jvm?.mem?.heap_used_in_bytes ?? NaN), 0) : NaN;

export function favoriteOptimizationConfiguration(args = []) {
  const options = { concurrency: '1,4,16', selectivity: 'all,partition10,tag1' };
  for (let cursor = 0; cursor < args.length; cursor++) {
    const flag = args[cursor];
    if (['--dry-run', '--instrument'].includes(flag)) { options[flag.slice(2)] = true; continue; }
    if (!['--config', '--count', '--directory', '--concurrency', '--selectivity', '--feedback-config'].includes(flag)) throw Error('Unknown optimization benchmark option: ' + flag);
    const value = args[++cursor]; if (!value || value.startsWith('--')) throw Error('Missing optimization benchmark option: ' + flag);
    options[flag.slice(2)] = value;
  }
  const count = Number(options.count), concurrencies = options.concurrency.split(',').map(Number), selectivities = options.selectivity.split(',');
  if (!options.config || ![100000, 1000000].includes(count)) throw Error('Provide --config and --count100000|1000000.');
  if (!options.directory && !options['dry-run'] && !options['feedback-config']) throw Error('Provide a new --directory.');
  if (concurrencies[0] !== 1 || concurrencies.some((value, index) => ![1, 4, 16].includes(value) || (index && value <= concurrencies[index - 1]))) throw Error('Concurrency must start at1 and increase within1,4,16.');
  if (!selectivities.length || new Set(selectivities).size !== selectivities.length || selectivities.some(value => !['all', 'partition10', 'tag1'].includes(value))) throw Error('Invalid or repeated selectivity.');
  return { configFile: path.resolve(options.config), count, ...(options.directory ? { directory: path.resolve(options.directory) } : {}), concurrencies, selectivities,
    requests: 32, durationMs: 10000, limit: 20, serviceTimeoutMs: 950, clientTimeoutMs: 1500, settleTimeoutMs: 600000,
    instrumentationServiceTimeoutMs: 30000, instrumentationClientTimeoutMs: 35000,
    dryRun: options['dry-run'] ?? false, instrument: options.instrument ?? false,
    ...(options['feedback-config'] ? { feedbackFile: path.resolve(options['feedback-config']) } : {}) };
}

export function validateFavoriteOptimizationCandidates(document) {
  if (document.schemaVersion !== 1 || !Array.isArray(document.candidates) || !document.candidates.length) throw Error('Provide schemaVersion1 and explicit candidates.');
  const ids = new Set();
  for (const candidate of document.candidates) {
    if (!/^[a-z0-9-]+$/.test(candidate.id ?? '') || ids.has(candidate.id) || !/^[a-z0-9-]+$/.test(candidate.method ?? '')) throw Error('Candidate IDs must be unique and methods explicit.');
    ids.add(candidate.id); safeIndexName(candidate.index);
    if (!candidate.parameters || candidate.parameters.bucketCount !== 256) throw Error('Optimization candidates must explicitly select256bins.');
    if (!/^\.\/[a-zA-Z0-9_/-]+\.mjs$/.test(candidate.builder?.module ?? '') || !/^[a-zA-Z_$][\w$]*$/.test(candidate.builder?.export ?? '')) throw Error('Specify a local query builder module and named export.');
    if (candidate.executor && (!/^\.\/[a-zA-Z0-9_/-]+\.mjs$/.test(candidate.executor.module ?? '') || !/^[a-zA-Z_$][\w$]*$/.test(candidate.executor.export ?? ''))) throw Error('Specify a local service executor module and named export.');
    if (candidate.realIndex != null) safeIndexName(candidate.realIndex);
  }
  return document.candidates;
}

export function favoriteOptimizationCases(candidates, config) {
  // Rotate which candidate runs first for each query; retain separate case metrics.
  return FAVORITE_WORKLOAD.filter(item => config.selectivities.includes(item.selectivity)).flatMap((item, ordinal) => {
    const offset = ordinal % candidates.length, ordered = [...candidates.slice(offset), ...candidates.slice(0, offset)];
    return ordered.map(candidate => ({ ...candidate, ...item, id: candidate.id + ':' + item.id, candidateId: candidate.id, queryId: item.id }));
  });
}
export function compileFavoriteOptimizationQuery(item, builder) {
  const body = builder({ method: item.method, parameters: item.parameters, query: item.query, filter: item.filter, limit: 20 });
  if (!body || typeof body !== 'object' || body.size !== 20 || !body.query) throw Error('Query builder must return a global top20 OpenSearch body.');
  if (body.profile) throw Error('Profiling is excluded from timed requests.');
  return { ...body, timeout: '950ms' };
}
export async function executeFavoriteOptimizationRequest(item, builder, executor, search = searchIndex) {
  const body = compileFavoriteOptimizationQuery(item, builder);
  return executor ? executor({ index: item.index, method: item.method, parameters: item.parameters, query: item.query,
    filter: item.filter, limit: 20, timeoutMs: 1500, serviceTimeout: '950ms' })
    : search(item.index, body, { timeoutMs: 1500 });
}
export function remainingFavoriteOptimizationConcurrencies(requested, warmups, profiles) {
  const failure = profiles.filter(profile => !profile.viableAtTestedLoad).map(profile => profile.concurrency), ceiling = failure.length ? Math.min(...failure) : Infinity;
  return requested.filter(value => value < ceiling && !profiles.some(profile => profile.concurrency === value) && (!warmups.some(failed) || value === 1));
}
export function summarizeFavoriteOptimizationProfile(measurement, warmups) {
  const summary = summarizeFavoriteTrials(measurement.trials, warmups);
  return { ...summary, strictFailures: summary.strictTimedFailures + summary.strictWarmupFailures,
    throughputPerSecond: measurement.trials.length / (measurement.elapsedMs / 1000),
    successfulThroughputPerSecond: measurement.trials.filter(row => !row.error).length / (measurement.elapsedMs / 1000) };
}
export function favoriteOptimizationResourcePeaks(samples) {
  const maximum = values => { const finite = values.filter(Number.isFinite); return finite.length ? Math.max(...finite) : null; };
  return { peakObservedHeapBytes: maximum(samples.map(heapBytes)), peakObservedClientRssBytes: maximum(samples.map(sample => sample.clientMemory?.rss)) };
}
// Diagnostic data only: bounded serialization keeps cyclic Error causes and
// executor stage evidence recordable without changing the request deadline.
function diagnosticValue(value, seen = new Set(), depth = 0) {
  if (typeof value === 'string') return value.slice(0, 16000);
  if (value == null || ['number', 'boolean'].includes(typeof value)) return value;
  if (depth >= 10) return '[depth limit]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const entries = value instanceof Error
    ? [...new Set(['name', 'message', 'code', 'errno', 'syscall', 'address', 'port', 'cause', 'errors', 'transport', ...Object.keys(value)])].filter(key => key !== 'evidence' && value[key] !== undefined)
    : Object.keys(value);
  const result = Array.isArray(value) ? value.slice(0, 256).map(item => diagnosticValue(item, seen, depth + 1))
    : Object.fromEntries(entries.slice(0, 256).map(key => [key, diagnosticValue(value[key], seen, depth + 1)]));
  seen.delete(value); return result;
}
export function favoriteOptimizationFailure(error) {
  return { error: String(error?.message ?? error), errorDetails: diagnosticValue(error),
    ...(error?.evidence ? { executionEvidence: diagnosticValue(error.evidence) } : {}) };
}
export async function observeFavoriteOptimizationTrial({ request, expectedHits, keepHits = false, keepExecutionEvidence = false,
  now = () => performance.now(), wallTime = () => new Date().toISOString() }) {
  const started = now(), startedAt = wallTime(); let observed;
  try {
    const response = await request();
    if (response.hits.length !== expectedHits) throw Error('Unexpected global top20 count for filter selectivity.');
    for (let i = 1; i < response.hits.length; i++) if (response.hits[i].score > response.hits[i - 1].score) throw Error('Service scores are not descending.');
    observed = { elapsedMs: now() - started, serviceTookMs: response.evidence.serviceTookMs, hitCount: response.hits.length, hitsHash: hash(response.hits),
      ...(keepHits ? { hits: response.hits } : {}), ...(keepExecutionEvidence ? { executionEvidence: response.evidence } : {}) };
  } catch (error) { const elapsedMs = now() - started; observed = { elapsedMs, ...favoriteOptimizationFailure(error), hitCount: 0 }; }
  return { startedAt, completedAt: wallTime(), ...observed };
}
export async function finalizeFavoriteOptimizationProfile({ identity, measurement, warmups, before, samples,
  readResources = favoriteResources, persist }) {
  let after = null, collectionError;
  try { after = await readResources(); samples.push(after); }
  catch (error) { collectionError = error; samples.push({ at: new Date().toISOString(), ...favoriteOptimizationFailure(error) }); }
  const summary = summarizeFavoriteOptimizationProfile(measurement, warmups);
  const profile = { ...identity, elapsedMs: measurement.elapsedMs, ...summary, trials: measurement.trials,
    measurementComplete: true, finalResourceCollectionComplete: after !== null,
    viableAtTestedLoad: summary.viableAtTestedLoad && after !== null,
    cpuMs: after ? cpuMs(after) - cpuMs(before) : null,
    clientCpuMs: after ? (after.clientCpu.user + after.clientCpu.system - before.clientCpu.user - before.clientCpu.system) / 1000 : null,
    ...favoriteOptimizationResourcePeaks(samples), resourceErrors: samples.filter(sample => sample.error).length,
    ...(collectionError ? { resourceCollectionError: favoriteOptimizationFailure(collectionError) } : {}), before, after, samples };
  await persist(profile);
  if (collectionError) throw collectionError;
  return profile;
}
export function summarizeFavoriteOptimizationInstrumentation(profile) {
  const result = { queryNodes: [], collectors: [], interpretation: 'Counts are raw per-node profile counters. Parent/child nodes can count the same document; these are not summed into distinct documents scored or skipped.' };
  const visit = (nodes, context, trail = []) => { for (const [index, node] of (nodes ?? []).entries()) {
    const queryPath = [...trail, index];
    result.queryNodes.push({ ...context, queryPath, type: node.type, description: node.description, timeInNanos: node.time_in_nanos,
      counts: Object.fromEntries(Object.entries(node.breakdown ?? {}).filter(([name]) => name.endsWith('_count'))), breakdown: node.breakdown ?? {} });
    visit(node.children, context, queryPath);
  } };
  for (const shard of profile?.shards ?? []) for (const [search, entry] of (shard.searches ?? []).entries()) {
    const context = { shard: shard.id, search }; visit(entry.query, context);
    for (const collector of entry.collector ?? []) result.collectors.push({ ...context, ...collector });
  }
  return result;
}
export function validateFavoriteOptimizationIndex(state, expectedCount, previous) {
  if (state.count !== expectedCount) throw Error(`Measured index count${state.count} does not equal requested${expectedCount}.`);
  if (!state.uuid || !state.mappingHash || !state.metadataHash || !state.indexing) throw Error('Missing index fingerprint evidence.');
  if (previous && !same({ uuid: state.uuid, mappingHash: state.mappingHash, metadataHash: state.metadataHash, indexing: state.indexing },
    { uuid: previous.uuid, mappingHash: previous.mappingHash, metadataHash: previous.metadataHash, indexing: previous.indexing })) throw Error('Index generation or source metadata changed during measurement.');
  return true;
}
export function favoriteOptimizationFeedbackConfig(candidates) {
  if (candidates.some(candidate => !candidate.realIndex)) throw Error('Every feedback candidate needs an explicit realIndex containing all545assets.');
  return { schemaVersion: 1, label: 'Favorite optimization variants: real545-image development feedback',
    description: 'Service-side global rankings compared against the endorsed favorite. Quantization or preset restrictions remain prototype choices; existing single-reviewer development judgments are not held-out evidence.',
    extraImageFiles: ['evaluation/perceived-red-pagoda-001.json'],
    workload: { warmup: 1, repeats: 3, concurrency: 1, limit: 20, accuracyLimit: 1000, timeoutMs: 10000 },
    candidates: candidates.map(candidate => ({ id: candidate.id, method: candidate.method, label: candidate.label ?? candidate.id, index: candidate.realIndex, parameters: candidate.parameters, module: './adapter.mjs' })) };
}

async function loadInputs(config) {
  const bytes = await readFile(config.configFile), candidates = validateFavoriteOptimizationCandidates(JSON.parse(bytes)), builders = new Map(), executors = new Map();
  for (const candidate of candidates) {
    const module = await import(new URL(candidate.builder.module, import.meta.url));
    const builder = module[candidate.builder.export];
    if (typeof builder !== 'function') throw Error('Query builder export missing: ' + candidate.id);
    builders.set(candidate.id, builder);
    if (candidate.executor) {
      const module = await import(new URL(candidate.executor.module, import.meta.url));
      const executor = module[candidate.executor.export];
      if (typeof executor !== 'function') throw Error('Service executor export missing: ' + candidate.id);
      executors.set(candidate.id, executor);
    }
  }
  const cases = favoriteOptimizationCases(candidates, config), plans = cases.map(item => {
    const body = compileFavoriteOptimizationQuery(item, builders.get(item.candidateId));
    return { caseId: item.id, candidateId: item.candidateId, index: item.index, body, bodyHash: hash(body),
      ...(item.executor ? { executor: item.executor, bodyRole: 'Reference scoring objective; executor source and warmup evidence record actual service stages.' } : {}) };
  });
  return { candidates, builders, executors, cases, plans, configHash: hash(bytes) };
}
async function sourceSnapshotFor(candidates) {
  const merged = { ...await favoriteSourceSnapshot(import.meta.url) };
  for (const candidate of candidates) {
    Object.assign(merged, await favoriteSourceSnapshot(new URL(candidate.builder.module, import.meta.url)));
    if (candidate.executor) Object.assign(merged, await favoriteSourceSnapshot(new URL(candidate.executor.module, import.meta.url)));
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}
async function inspectIndex(index) {
  const mapping = (await api(index + '/_mapping')).body[index]?.mappings, settings = (await api(index + '/_settings')).body[index]?.settings?.index;
  const count = (await api(index + '/_count')).body.count, stats = (await api(index + '/_stats/store,docs,segments,indexing,merge')).body;
  const primary = stats.indices?.[index]?.primaries;
  if (Number(settings?.number_of_shards) !== 1 || Number(settings?.number_of_replicas) !== 0 || !primary?.indexing) throw Error('Require a single-shard index with no replicas and indexing counters.');
  return { index, at: new Date().toISOString(), count, uuid: settings.uuid, mapping, settings, stats,
    mappingHash: hash(canonical(mapping)), metadataHash: hash(canonical(mapping?._meta ?? {})),
    indexing: { index_total: primary.indexing.index_total, delete_total: primary.indexing.delete_total } };
}
export async function dryRunFavoriteOptimization(config) {
  const inputs = await loadInputs(config), sourceSnapshot = await sourceSnapshotFor(inputs.candidates);
  return { dryRun: true, noServiceRequests: true, configuration: config, configHash: inputs.configHash, sourceSnapshotHash: hash(sourceSnapshot), candidates: inputs.candidates,
    cases: inputs.cases, plans: inputs.plans, maximumProfiles: inputs.cases.length * config.concurrencies.length, actualCountVerified: false };
}

export async function runFavoriteOptimizationBenchmark(config) {
  if (new URL(BASE).port !== '19217') throw Error('Optimization performance queries require isolated OpenSearch port19217.');
  const inputs = await loadInputs(config), sourceSnapshot = await sourceSnapshotFor(inputs.candidates), indexes = [...new Set(inputs.candidates.map(candidate => candidate.index))];
  const indexBefore = [];
  for (const index of indexes) { const state = await inspectIndex(index); validateFavoriteOptimizationIndex(state, config.count); indexBefore.push(state); }
  const plan = { schemaVersion: 1, experiment: 'favorite-optimization-benchmark', configuration: config, configHash: inputs.configHash, candidates: inputs.candidates,
    cases: inputs.cases, queryPlans: inputs.plans, sourceSnapshotHash: hash(sourceSnapshot), sourceHashes: Object.fromEntries(Object.entries(sourceSnapshot).map(([file, text]) => [file, hash(text)])),
    indexFingerprints: indexBefore.map(({ index, count, uuid, mappingHash, metadataHash, indexing }) => ({ index, count, uuid, mappingHash, metadataHash, indexing })) };
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  await writeFile(path.join(config.directory, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
  await writeFile(path.join(config.directory, 'source-snapshot.json'), JSON.stringify(sourceSnapshot, null, 2), { flag: 'wx' });
  const result = { ...plan, startedAt: new Date().toISOString(), planHash: hash(plan), indexBefore, profiles: [], warmups: [], skipped: [], settling: [], instrumentation: [],
    latencyBoundary: 'Query compilation through decoded OpenSearch global top20.950ms server/1500ms client; any error or>=1000ms including warmups fails. Successful-only latency percentiles; union failure counts.',
    limitations: ['Synthetic descriptor mixtures are not independent photographs. Index/source fingerprints are captured; extraction and indexing correctness are verified separately.',
      'One shared host/node, one shard and zero replicas. Closed-loop clients self-throttle; passing results still need scheduled-arrival validation.',
      'Request cache is disabled; filter/OS caches are uncontrolled. Explicit warmups and repeated queries favor warm caches.',
      'Per-case profiles remain separate; cheap selective queries do not hide expensive unfiltered queries.',
      'CPU counters include background activity; one-second resource samples may miss peaks. External cgroup/RSS monitoring complements these samples.',
      'profile:true instrumentation runs after timing with30s server/35s client timeouts and is excluded from latency and viability summaries. Raw nested counters are not distinct-document totals.'] };
  const save = () => atomicJson(path.join(config.directory, 'benchmark.json'), result), recorder = createFavoriteRecorder(config.directory);
  const settle = async context => { const observation = await settleFavoriteActivity({ timeoutMs: config.settleTimeoutMs }); result.settling.push({ ...context, ...observation }); await save(); if (!observation.settled) throw Error('Optimization search/merge activity did not settle.'); };
  const trial = async (item, phase, concurrency, ordinal, profileId) => {
    const observed = await observeFavoriteOptimizationTrial({
      request: () => executeFavoriteOptimizationRequest(item, inputs.builders.get(item.candidateId), inputs.executors.get(item.candidateId)),
      expectedHits: Math.min(20, favoriteEligibleCount(config.count, item)), keepHits: phase === 'warmup',
      keepExecutionEvidence: phase === 'warmup' && Boolean(item.executor),
    });
    const row = { count: config.count, caseId: item.id, candidateId: item.candidateId, method: item.method, index: item.index, parameters: item.parameters,
      queryId: item.queryId, selectivity: item.selectivity, phase, concurrency, ordinal, profileId, requestId: `${profileId}:${ordinal}`, ...observed, overOneSecond: observed.elapsedMs >= 1000 };
    await recorder.record('requests.jsonl', row); return compactFavoriteTrial(row);
  };
  console.log('FAVORITE_OPTIMIZATION_ARTIFACT ' + path.join(config.directory, 'benchmark.json')); await save();
  try {
    result.engineVersion = (await api('')).body.version;
    for (const item of inputs.cases) {
      await settle({ caseId: item.id, phase: 'before-warmup' });
      const warmups = [await trial(item, 'warmup', 1, 0, item.id + ':warmup')]; result.warmups.push({ caseId: item.id, candidateId: item.candidateId, count: config.count, trials: warmups }); await recorder.flush(); await save();
      const completed = [];
      for (const concurrency of remainingFavoriteOptimizationConcurrencies(config.concurrencies, warmups, completed)) {
        await settle({ caseId: item.id, concurrency, phase: 'before-profile' });
        const profileId = `${config.count}:${item.id}:c${concurrency}`, before = await favoriteResources(), samples = [before]; let pendingSample = Promise.resolve(), sampling = false, stopped = false;
        const timer = setInterval(() => {
          if (sampling || stopped) return; sampling = true;
          pendingSample = favoriteResources().then(async sample => { samples.push(sample); await recorder.record('resources.jsonl', { profileId, ...sample }); })
            .catch(error => { samples.push({ ...favoriteOptimizationFailure(error), at: new Date().toISOString() }); }).finally(() => { sampling = false; });
        }, 1000);
        let measurement;
        try { measurement = await runWorkload({ items: [item], concurrency, repetitions: config.requests, durationMs: config.durationMs, trial: (_, ordinal) => trial(item, 'timed', concurrency, ordinal, profileId) }); }
        finally { stopped = true; clearInterval(timer); await pendingSample; }
        const profile = await finalizeFavoriteOptimizationProfile({
          identity: { id: profileId, count: config.count, caseId: item.id, candidateId: item.candidateId, method: item.method, index: item.index, parameters: item.parameters,
            queryId: item.queryId, selectivity: item.selectivity, concurrency, minimumRequests: config.requests, requestedDurationMs: config.durationMs },
          measurement, warmups, before, samples,
          persist: async profile => { result.profiles.push(profile); completed.push(profile); await recorder.flush(); result.recording = recorder.observation(); await save(); },
        });
        console.log(JSON.stringify({ ...profile, trials: undefined, before: undefined, after: undefined, samples: undefined }));
        await settle({ caseId: item.id, concurrency, phase: 'after-profile' }); if (!profile.viableAtTestedLoad) break;
      }
      const omitted = config.concurrencies.filter(concurrency => !completed.some(profile => profile.concurrency === concurrency));
      if (omitted.length) { result.skipped.push({ caseId: item.id, concurrencies: omitted, reason: 'Strict warmup/timed failure prevents higher load.' }); await save(); }
    }
    result.instrumentationSkipped = config.instrument ? inputs.cases.filter(item => item.executor && item.selectivity === 'all' && ['picked-one-vibe', 'picked-five-portions'].includes(item.queryId))
      .map(item => ({ caseId: item.id, reason: 'Custom service executor: a profile of its reference body would misrepresent actual execution. Warmups retain executor stage evidence.' })) : [];
    if (config.instrument) for (const item of inputs.cases.filter(item => !item.executor && item.selectivity === 'all' && ['picked-one-vibe', 'picked-five-portions'].includes(item.queryId))) {
      await settle({ caseId: item.id, phase: 'before-instrumentation' });
      const body = { ...compileFavoriteOptimizationQuery(item, inputs.builders.get(item.candidateId)), timeout: config.instrumentationServiceTimeoutMs + 'ms', profile: true };
      const observation = { caseId: item.id, candidateId: item.candidateId, index: item.index, startedAt: new Date().toISOString(), excludedFromTiming: true, excludedFromViability: true,
        serverTimeoutMs: config.instrumentationServiceTimeoutMs, clientTimeoutMs: config.instrumentationClientTimeoutMs, bodyHash: hash(body) };
      try { const response = await api(item.index + '/_search?request_cache=false', { method: 'POST', body, timeoutMs: config.instrumentationClientTimeoutMs }); Object.assign(observation, response,
        { partial: Boolean(response.body.timed_out || response.body._shards?.failed), summary: summarizeFavoriteOptimizationInstrumentation(response.body.profile) }); }
      catch (error) { observation.error = error.message; }
      observation.finishedAt = new Date().toISOString(); result.instrumentation.push(observation); await save(); await settle({ caseId: item.id, phase: 'after-instrumentation' });
    }
    await settle({ phase: 'after-campaign' }); result.indexAfter = [];
    for (const initial of indexBefore) { const current = await inspectIndex(initial.index); validateFavoriteOptimizationIndex(current, config.count, initial); result.indexAfter.push(current); }
    if (hash(await sourceSnapshotFor(inputs.candidates)) !== hash(sourceSnapshot) || hash(await readFile(config.configFile)) !== inputs.configHash) throw Error('Benchmark query source or configuration changed during measurement.');
    await recorder.close(); result.recording = recorder.observation(); result.finishedAt = new Date().toISOString(); await save(); return { directory: config.directory, result };
  } catch (error) { try { await recorder.close(); } catch (recordingError) { result.recordingError = recordingError.message; } result.recording = recorder.observation(); result.interruption = { at: new Date().toISOString(), ...favoriteOptimizationFailure(error), stack: error.stack ?? String(error) }; await save(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = favoriteOptimizationConfiguration(process.argv.slice(2));
  if (config.feedbackFile) {
    const candidates = validateFavoriteOptimizationCandidates(JSON.parse(await readFile(config.configFile)));
    await writeFile(config.feedbackFile, JSON.stringify(favoriteOptimizationFeedbackConfig(candidates), null, 2), { flag: 'wx' });
    console.log('FEEDBACK_CONFIG ' + config.feedbackFile);
  } else if (config.dryRun) console.log(JSON.stringify(await dryRunFavoriteOptimization(config), null, 2));
  else await runFavoriteOptimizationBenchmark(config);
}
