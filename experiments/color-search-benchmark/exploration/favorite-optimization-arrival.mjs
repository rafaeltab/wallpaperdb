// THROWAWAY load experiment. OpenSearch returns every final ranking; the client
// only schedules requests and records evidence, including waiting and failures.
import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { runArrivals } from './arrival-scheduler.mjs';
import { summarizeFavoriteArrival } from './favorite-arrival.mjs';
import { FAVORITE_WORKLOAD } from './favorite-scale-corpus.mjs';
import { validateFavoriteOptimizationCandidates, compileFavoriteOptimizationQuery, validateFavoriteOptimizationIndex, executeFavoriteOptimizationRequest, favoriteOptimizationFailure } from './favorite-optimization-benchmark.mjs';
import { favoriteResources, favoriteSourceSnapshot, settleFavoriteActivity } from './favorite-scale.mjs';
import { BASE, api, hash } from './service.mjs';
import { favoriteUtilityParameters, createFavoriteUtilityPlan } from './favorite-utilities.mjs';
import { favoriteWideQueries, FAVORITE_WIDE_DEFINITION } from './favorite-wide-workload.mjs';
import { FAVORITE_DOCVALUE_FETCH_METHODS } from './favorite-docvalue-fetch.mjs';
import { FAVORITE_MAXIMA_BOUNDED_METHODS, FAVORITE_MAXIMA_BOUNDED_DEFINITION } from './favorite-maxima-bounded-utilities.mjs';
import { FAVORITE_POOLED_METHODS, FAVORITE_POOLED_DEFINITION } from './favorite-pooled-utilities.mjs';
import { FAVORITE_PRESET_WORKLOAD, favoritePresetId, withFavoritePresets, favoritePresetWarmupOrdinals,
  summarizeFavoritePresetCoverage } from './favorite-preset-workload.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => hash(canonical(left)) === hash(canonical(right));
const failed = row => Boolean(row.error) || !Number.isFinite(row.elapsedMs) || row.elapsedMs >= 1000;
const atomicJson = async (file, value) => { await writeFile(file + '.tmp', JSON.stringify(value, null, 2)); await rename(file + '.tmp', file); };
export const summarizeOptimizationArrival = summarizeFavoriteArrival;

export function optimizationArrivalConfiguration(args = []) {
  const options = { rates: '8,32,64,128', workload: 'varied', 'duration-seconds': '30' };
  for (let cursor = 0; cursor < args.length; cursor++) {
    const flag = args[cursor], value = args[++cursor];
    if (!['--config', '--artifact', '--directory', '--rates', '--workload', '--duration-seconds'].includes(flag) || !value || value.startsWith('--')) throw Error('Invalid arrival option: ' + flag);
    options[flag.slice(2)] = value;
  }
  if (!options.config || !options.artifact || !options.directory) throw Error('Provide --config, --artifact and new --directory.');
  const rates = options.rates.split(',').map(Number);
  if (rates.some((rate, i) => !Number.isInteger(rate) || rate < 1 || rate > 512 || (i && rate <= rates[i - 1]))) throw Error('Rates must increase within1..512.');
  if (!['fixed', 'varied', 'wide', 'presets-fixed', 'presets-varied', 'presets-wide'].includes(options.workload)) throw Error('Workload must be fixed, varied, wide, presets-fixed, presets-varied or presets-wide.');
  const durationSeconds = Number(options['duration-seconds']);
  const maximumDuration = options.workload === 'presets-wide' ? 1800 : 600;
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > maximumDuration) throw Error('Arrival duration must be integer seconds within1..' + maximumDuration + '.');
  const directory = path.resolve(options.directory), artifact = path.resolve(options.artifact);
  if (directory === path.dirname(artifact)) throw Error('Preserve primary evidence in a separate directory.');
  return { configFile: path.resolve(options.config), artifact, directory, rates, workload: options.workload, durationMs: durationSeconds * 1000, maxInFlight: 128, limit: 20, serviceTimeoutMs: 950, clientTimeoutMs: 1500 };
}

function hueHex(hue) {
  const h = hue / 60, x = 1 - Math.abs(h % 2 - 1);
  const rgb = h < 1 ? [1,x,0] : h < 2 ? [x,1,0] : h < 3 ? [0,1,x] : h < 4 ? [0,x,1] : h < 5 ? [x,0,1] : [1,0,x];
  return '#' + rgb.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
}
export function optimizationArrivalQueries(workload) {
  if (['presets-fixed', 'presets-varied', 'presets-wide'].includes(workload)) return withFavoritePresets(optimizationArrivalQueries(workload.slice('presets-'.length)));
  if (workload === 'wide') return favoriteWideQueries();
  const fixed = FAVORITE_WORKLOAD.filter(item => item.selectivity === 'all');
  if (workload === 'fixed') return fixed;
  if (workload !== 'varied') throw Error('Unknown arrival workload.');
  const colors = [...Array.from({ length: 24 }, (_, i) => hueHex(i * 15)), '#ffffff', '#000000', '#777777', '#804030', '#ff99cc', '#003311'];
  return [...fixed, ...colors.flatMap((color, index) => [
    { id: 'vibe-' + color.slice(1), query: { mode: 'vibe', targets: [{ color }] } },
    { id: 'portion-' + color.slice(1), query: { mode: 'proportions', targets: [{ color, percent: [20, 40, 60, 80][index % 4] }] } },
  ]), ...Array.from({ length: 8 }, (_, i) => ({ id: 'pair-' + i, query: { mode: 'proportions', targets: [{ color: colors[i * 3], percent: 50 }, { color: colors[(i * 3 + 12) % 24], percent: 50 }] } })),
  ...['dark', 'grayscale', 'bright'].map(name => ({ id: 'named-' + name, query: { mode: 'vibe', targets: [{ name }] } }))];
}

/** One parameter merge shared by preflight, execution and recorded identity. */
export function optimizationArrivalItem(candidate, item) {
  return { ...candidate, ...item, parameters: { ...candidate.parameters, ...item.parameters } };
}

export function compileOptimizationArrivalPlans(candidate, queries, builder) {
  return queries.map((item, queryOrdinal) => {
    const input = optimizationArrivalItem(candidate, item), body = compileFavoriteOptimizationQuery(input, builder);
    const utilityKeys = [...new Set(scoringFields(body).flatMap(({ field }) => {
      if (field.startsWith('utilities.')) return [field.slice('utilities.'.length)];
      const rank = /^utility_(rank8|rank16|rankfloat|rank18|rank27)_q\d+_w\d+\.(.+)$/.exec(field);
      if (!rank) return [];
      return [rank[1] === 'rank16' ? rank[2].replace(/_(hi|lo)$/, '')
        : ['rank18', 'rank27'].includes(rank[1]) ? rank[2].replace(/_d\d$/, '') : rank[2]];
    }))].sort();
    return { candidateId: candidate.id, queryId: item.id, queryOrdinal, parameters: input.parameters,
      mode: input.query.mode, targetCount: input.query.targets.length, utilityKeys, body,
      ...(candidate.executor ? { executor: candidate.executor, bodyRole: 'Reference scoring objective; executor source and warmup evidence record actual service stages.' } : {}) };
  });
}

export function optimizationArrivalWarmupOrdinals(workload, count) {
  if (!['fixed', 'varied', 'wide', 'presets-fixed', 'presets-varied', 'presets-wide'].includes(workload) || !Number.isSafeInteger(count) || count < 1) throw Error('Invalid warmup workload or query count.');
  if (workload === 'presets-wide') return favoritePresetWarmupOrdinals(count / 9);
  const selected = workload === 'wide' ? Math.min(64, count) : count;
  return Array.from({ length: selected }, (_, ordinal) => selected === 1 ? 0 : Math.floor(ordinal * (count - 1) / (selected - 1)));
}

export function optimizationArrivalTrialIdentity(candidate, queries, queryOffset) {
  if (!queries.length || !Number.isSafeInteger(queryOffset) || queryOffset < 0) throw Error('Invalid arrival query offset.');
  const queryOrdinal = queryOffset % queries.length, item = queries[queryOrdinal];
  return { queryOffset, queryOrdinal, queryId: item.id, parameters: optimizationArrivalItem(candidate, item).parameters };
}

export async function runOptimizationArrivalWarmups({ candidate, queries, queryOrdinals, request,
  record = async () => {}, now = () => performance.now() }) {
  const rows = [];
  for (const [ordinal, queryOrdinal] of queryOrdinals.entries()) {
    const started = now(); let observed;
    try { observed = await request(queryOrdinal, true); } catch (error) {
      observed = favoriteOptimizationFailure(error);
    }
    const row = { candidateId: candidate.id, phase: 'warmup', ordinal, schedulerDelayMs: 0, elapsedMs: now() - started, ...observed,
      ...optimizationArrivalTrialIdentity(candidate, queries, queryOrdinal) };
    rows.push(row); await record(row);
  }
  return rows;
}

/** These counts use saved preflight plans after timing has stopped. A failed
 * dispatch is not proof that OpenSearch evaluated its fields. */
export function summarizeOptimizationArrivalCoverage({ trials, queryPlans, expectedUtilityKeys = [], includePresets = false }) {
  const byId = new Map(queryPlans.map(plan => [plan.queryId, plan]));
  const expected = new Set(expectedUtilityKeys);
  for (const row of trials) {
    const plan = byId.get(row.queryId);
    if (!plan || row.queryOrdinal !== plan.queryOrdinal || !same(row.parameters, plan.parameters)) throw Error('Arrival request differs from its preflight identity: ' + row.queryId);
  }
  const counts = rows => {
    const queryIds = new Set(), keys = new Set(), targetCounts = {}, modes = {};
    for (const row of rows) {
      const plan = byId.get(row.queryId); queryIds.add(row.queryId);
      for (const key of plan.utilityKeys) keys.add(key);
      targetCounts[plan.targetCount] = (targetCounts[plan.targetCount] ?? 0) + 1;
      modes[plan.mode] = (modes[plan.mode] ?? 0) + 1;
    }
    const unexpected = [...keys].filter(key => !expected.has(key));
    if (expected.size && unexpected.length) throw Error('Arrival requested utilities outside the declared full bank.');
    return { requests: rows.length, distinctQueryCount: queryIds.size, queryIds: [...queryIds].sort(), targetCounts, modes,
      utilityKeyCount: keys.size, utilityKeys: [...keys].sort(), utilityKeyFraction: expected.size ? keys.size / expected.size : null,
      fullUtilityBankCovered: expected.size > 0 && keys.size === expected.size && !unexpected.length };
  };
  return { workloadQueryCount: queryPlans.length, expectedUtilityKeyCount: expected.size,
    utilityCoverageAvailable: expected.size > 0,
    firstQueryOffset: trials.length ? trials[0].queryOffset : null,
    nextQueryOffset: trials.length ? trials.at(-1).queryOffset + 1 : null,
    latencyLabel: 'Mixed workload latency across the actual recorded target counts, including five-color requests when present; not a per-shape latency guarantee.',
    coverageBoundary: 'Scheduled includes rejections; dispatched includes client attempts and errors that may precede a service request; successful includes only complete returned rankings. Utility keys come from actual compiled scoring fields, not the intended workload size.',
    scheduled: counts(trials), dispatched: counts(trials.filter(row => !row.clientRejected)),
    successful: counts(trials.filter(row => !row.clientRejected && !row.error && Number.isFinite(row.elapsedMs))),
    ...(includePresets ? { presets: summarizeFavoritePresetCoverage({ trials, queryPlans }) } : {}) };
}

function missingFixedApproval(candidate, artifact) {
  return optimizationArrivalQueries('fixed').filter(item => {
    const profiles = artifact.profiles.filter(profile => profile.candidateId === candidate.id && profile.queryId === item.id && profile.selectivity === 'all' && profile.concurrency === 1);
    const warmups = artifact.warmups.filter(group => group.candidateId === candidate.id && group.caseId === candidate.id + ':' + item.id).flatMap(group => group.trials ?? []);
    return profiles.length !== 1 || !warmups.length || warmups.some(failed) || profiles.some(profile => !profile.viableAtTestedLoad || !(profile.minimumRequests >= 32) || !(profile.requestedDurationMs >= 10000) || !(profile.elapsedMs >= 10000) || !Array.isArray(profile.trials) || profile.trials.length < 32 || profile.trials.some(failed));
  });
}

/** Every mixed preset needs its own completed four-shape C1 approval, on the
 * same index and unchanged builder/executor. Candidate IDs may differ. */
export function optimizationArrivalPresetApprovals(candidate, artifact) {
  return FAVORITE_PRESET_WORKLOAD.presets.map(preset => {
    const parameters = { ...candidate.parameters, ...preset.parameters };
    const siblings = artifact.candidates.filter(item => item.method === candidate.method && item.index === candidate.index
      && same(item.builder, candidate.builder) && same(item.executor ?? null, candidate.executor ?? null)
      && same(item.parameters, parameters));
    if (siblings.length !== 1 || missingFixedApproval(siblings[0], artifact).length) throw Error('Missing or failed all-preset C1 approval: ' + candidate.id + '/' + preset.id);
    return siblings[0];
  });
}

export function selectOptimizationArrivalCandidates(candidates, artifact, { requireAllPresets = false } = {}) {
  if (!artifact.finishedAt || artifact.experiment !== 'favorite-optimization-benchmark' || artifact.configuration?.count !== 1000000) throw Error('Require a finished million-record optimization benchmark.');
  const selected = [], omitted = [];
  for (const candidate of candidates) {
    const previous = artifact.candidates.find(item => item.id === candidate.id);
    if (!previous || !same(previous, candidate)) throw Error('Primary candidate identity or parameters changed: ' + candidate.id);
    const missing = missingFixedApproval(candidate, artifact);
    if (missing.length) omitted.push({ candidateId: candidate.id, reason: 'Strict C1 evidence failed or missing', queryIds: missing.map(item => item.id) });
    else {
      try { if (requireAllPresets) optimizationArrivalPresetApprovals(candidate, artifact); selected.push(candidate); }
      catch (error) { omitted.push({ candidateId: candidate.id, reason: error.message }); }
    }
  }
  return { selected, omitted };
}

export function validateOptimizationArrivalPrimary({ candidate, artifact, builderSources, executorSources = {}, queryPlans }) {
  if (candidate.executor && !Object.keys(executorSources).length) throw Error('Primary executor source graph is missing: ' + candidate.id);
  const sources = mergeArrivalSources(builderSources, executorSources), sourceFiles = Object.keys(sources);
  if (!Object.keys(builderSources).length || !artifact.sourceHashes || sourceFiles.some(file => artifact.sourceHashes[file] !== hash(sources[file]))) {
    throw Error('Primary builder/executor source or dependency changed: ' + candidate.id);
  }
  const verifiedPlans = [];
  for (const item of optimizationArrivalQueries('fixed')) {
    const previous = (artifact.queryPlans ?? []).filter(plan => plan.candidateId === candidate.id && plan.caseId === candidate.id + ':' + item.id);
    const current = queryPlans.filter(plan => plan.candidateId === candidate.id && plan.queryId === item.id);
    if (previous.length === 1 && !same(previous[0].executor ?? null, candidate.executor ?? null)) throw Error('Primary executor query-plan binding differs: ' + candidate.id);
    if (previous.length !== 1 || current.length !== 1 || previous[0].index !== candidate.index
      || !previous[0].body || hash(previous[0].body) !== previous[0].bodyHash || !same(previous[0].body, current[0].body)) {
      throw Error('Primary fixed query plan is missing or changed: ' + candidate.id + ':' + item.id);
    }
    verifiedPlans.push({ queryId: item.id, bodyHash: previous[0].bodyHash });
  }
  return { candidateId: candidate.id, sourceFiles, executorSourceFiles: Object.keys(executorSources), verifiedPlans };
}

function mergeArrivalSources(...snapshots) {
  const merged = {};
  for (const snapshot of snapshots) for (const [file, text] of Object.entries(snapshot)) {
    if (Object.hasOwn(merged, file) && merged[file] !== text) throw Error('Source changed between builder/executor snapshots: ' + file);
    merged[file] = text;
  }
  return merged;
}

export async function loadOptimizationArrivalModules(candidates, {
  load = url => import(url), snapshot = favoriteSourceSnapshot,
} = {}) {
  const builders = new Map(), executors = new Map(), builderSnapshots = new Map(), executorSnapshots = new Map();
  let sources = {};
  for (const candidate of candidates) {
    const builderUrl = new URL(candidate.builder.module, import.meta.url), module = await load(builderUrl);
    if (typeof module[candidate.builder.export] !== 'function') throw Error('Missing builder: ' + candidate.id);
    builders.set(candidate.id, module[candidate.builder.export]);
    const builderSource = await snapshot(builderUrl); builderSnapshots.set(candidate.id, builderSource);
    sources = mergeArrivalSources(sources, builderSource);
    if (candidate.executor) {
      const executorUrl = new URL(candidate.executor.module, import.meta.url), executionModule = await load(executorUrl);
      if (typeof executionModule[candidate.executor.export] !== 'function') throw Error('Missing executor: ' + candidate.id);
      executors.set(candidate.id, executionModule[candidate.executor.export]);
      const executorSource = await snapshot(executorUrl); executorSnapshots.set(candidate.id, executorSource);
      sources = mergeArrivalSources(sources, executorSource);
    }
  }
  return { builders, executors, builderSnapshots, executorSnapshots, sources };
}

export async function executeOptimizationArrivalRequest({ candidate, item, builder, executor, search, includeExecutionEvidence = false }) {
  const response = await executeFavoriteOptimizationRequest(optimizationArrivalItem(candidate, item), builder, executor, search);
  if (response.hits.length !== 20 || response.hits.some((hit, i) => i && hit.score > response.hits[i - 1].score)) throw Error('Incomplete or unordered global top20.');
  return { queryId: item.id, serviceTookMs: response.evidence.serviceTookMs, hitCount: response.hits.length, hitsHash: hash(response.hits),
    ...(includeExecutionEvidence && executor ? { executionEvidence: response.evidence } : {}) };
}

// Return the diagnostic error as data so the generic scheduler preserves it.
// It still computes elapsed time, queue delay and failure counts itself.
export async function observeOptimizationArrivalRequest(request) {
  const startedAt = new Date().toISOString(); let observed;
  try { observed = await request(); }
  catch (error) { observed = favoriteOptimizationFailure(error); }
  return { startedAt, completedAt: new Date().toISOString(), ...observed };
}

export async function finalizeOptimizationArrivalProfile({ measurement, trials, warmups, identity, before, samples,
  recordTrials, readResources = favoriteResources, persist }) {
  // Even an interrupted final stats read must leave the completed rate's raw
  // requests on disk. These writes occur after the measured request window.
  await recordTrials(trials);
  let after = null, collectionError;
  try { after = await readResources(); samples.push(after); }
  catch (error) { collectionError = error; samples.push({ at: new Date().toISOString(), ...favoriteOptimizationFailure(error) }); }
  const summary = summarizeOptimizationArrival(trials, warmups);
  const profile = { ...measurement, ...summary, ...identity, trials, before, after, samples,
    measurementComplete: true, finalResourceCollectionComplete: after !== null,
    viableAtTestedLoad: summary.viableAtTestedLoad && after !== null,
    resourceErrors: samples.filter(sample => sample.error).length,
    ...(collectionError ? { cpuMs: null, clientCpuMs: null, resourceCollectionError: favoriteOptimizationFailure(collectionError) } : {}) };
  await persist(profile);
  if (collectionError) throw collectionError;
  return profile;
}

function scoringFields(body) {
  const fields = new Map();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.rank_feature?.field) fields.set(value.rank_feature.field, 'rank_feature');
    if (value.field_value_factor?.field) fields.set(value.field_value_factor.field, 'numeric');
    // Original/fused/typed scorers carry explicit required-field filters. This
    // also covers fields accessed through parameterized script instructions.
    if (value.exists?.field) fields.set(value.exists.field, 'numeric');
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(body.query);
  for (const sort of body.sort ?? []) if (sort && typeof sort === 'object') {
    for (const field of Object.keys(sort)) if (field.startsWith('utilities.')) fields.set(field, 'numeric');
  }
  return [...fields].map(([field, kind]) => ({ field, kind }));
}
function mappedField(mapping, field) {
  return field.split('.').reduce((node, key) => node?.properties?.[key], mapping);
}
export function validateOptimizationArrivalFields({ candidate, state, queryPlans, workload }) {
  const mapping = state.mapping, meta = mapping?._meta ?? {}, scope = meta.scope ?? meta.identity?.scope;
  if ((['varied', 'wide'].includes(workload) || workload.startsWith('presets-')) && scope !== 'full') throw Error('Varied/wide/preset colors require a verified full-schema index: ' + candidate.id);
  let encoding = null;
  // Only explicitly registered wrappers inherit a parent's schema.
  // Unknown suffixes retain their existing unsupported-encoding rejection.
  const fetchMethod = FAVORITE_DOCVALUE_FETCH_METHODS.find(method => method.id === candidate.method);
  const pooledMethod = FAVORITE_POOLED_METHODS.find(method => method.id === candidate.method);
  const maximaMethod = FAVORITE_MAXIMA_BOUNDED_METHODS.find(method => method.id === (pooledMethod?.parentMethod ?? candidate.method));
  const parentMethod = fetchMethod?.parentMethod ?? maximaMethod?.parentMethod ?? pooledMethod?.parentMethod ?? candidate.method,
    docvalueIdRequired = Boolean(fetchMethod || maximaMethod || pooledMethod);
  if (pooledMethod && (candidate.builder?.module !== './favorite-pooled-utilities.mjs' || candidate.builder.export !== 'buildFavoritePooledQuery'
    || candidate.executor?.module !== './favorite-pooled-utilities.mjs' || candidate.executor.export !== 'executeFavoritePooledUtilitySearch')) throw Error('Pooled method requires its explicit builder and service executor.');
  if (maximaMethod && !pooledMethod && (candidate.builder?.module !== './favorite-maxima-bounded-utilities.mjs' || candidate.builder.export !== 'buildFavoriteMaximaBoundedQuery'
    || candidate.executor?.module !== './favorite-maxima-bounded-utilities.mjs' || candidate.executor.export !== 'executeFavoriteMaximaBoundedUtilitySearch')) throw Error('Maxima method requires its explicit builder and service executor.');
  const numericPointsRequired = ['favorite-utility-sorted', 'favorite-utility-sorted-scored', 'favorite-utility-bounded'].includes(parentMethod);
  if (docvalueIdRequired && (mapping.properties?.id?.type !== 'keyword' || mapping.properties.id.doc_values === false)) throw Error('Keyword ID with doc values is required: ' + candidate.id);
  if (parentMethod.startsWith('favorite-utility-')) {
    encoding = numericPointsRequired ? 'numeric' : parentMethod.slice('favorite-utility-'.length);
    const precision = ['rank18', 'rank27'].includes(encoding);
    const compiled = meta.experiment === 'strict-hue-favorite-compiled-utilities';
    const compiledMatches = (!compiled && meta.compiledEncoderVersion === undefined) || meta.compiledEncoderVersion === 1;
    const definitionMatches = precision
      ? (compiled || meta.experiment === 'strict-hue-favorite-precision-utilities') && meta.precisionDefinitionVersion === 1 && meta.parentUtilityDefinitionVersion === 2
      : ['numeric', 'rank8', 'rank16', 'rankfloat'].includes(encoding) && (compiled || meta.experiment === 'strict-hue-favorite-utilities') && meta.utilityDefinitionVersion === 2;
    if (!definitionMatches || !compiledMatches || meta.mode !== 'scale' || meta.count !== 1000000 || !meta.identityHash || !meta.planHash
      || !Array.isArray(meta.encodings) || !meta.encodings.includes(encoding)) throw Error('Index utility definition or encoding is unavailable: ' + candidate.id);
    if (numericPointsRequired && meta.numericPoints !== true) throw Error('Numeric point-indexed utility metadata is required: ' + candidate.id);
    const parameters = favoriteUtilityParameters(candidate.parameters);
    if (!['all', 'favorite'].includes(meta.presets) || (meta.presets === 'favorite'
      && (parameters.qualityInfluence !== .5 || parameters.cutoffBlendExponent !== 1))) throw Error('Index does not contain the requested scoring preset: ' + candidate.id);
  }
  const plans = queryPlans.filter(plan => plan.candidateId === candidate.id);
  if (!plans.length) throw Error('Missing candidate query plans: ' + candidate.id);
  const required = new Map();
  for (const plan of plans) {
    let parameters;
    if (encoding) {
      parameters = favoriteUtilityParameters(plan.parameters ?? candidate.parameters);
      if (meta.presets === 'favorite' && (parameters.qualityInfluence !== .5 || parameters.cutoffBlendExponent !== 1)) throw Error('Index does not contain the query scoring preset: ' + candidate.id + ':' + plan.queryId);
    }
    const fields = scoringFields(plan.body);
    if (!fields.length) throw Error('Query has no inspectable scoring fields: ' + candidate.id + ':' + plan.queryId);
    for (const { field, kind } of fields) {
      if (encoding) {
        const suffix = `_q${String(parameters.qualityInfluence * 100).padStart(3, '0')}_w${parameters.cutoffBlendExponent}`;
        const encodingMatches = encoding === 'numeric' ? kind === 'numeric' && field.startsWith('utilities.') && field.endsWith(suffix)
          : kind === 'rank_feature' && field.startsWith(`utility_${encoding}${suffix}.`);
        if (!encodingMatches) throw Error('Query scoring field uses an unexpected encoding or preset: ' + candidate.id + '/' + field);
      }
      const root = kind === 'rank_feature' ? field.slice(0, field.lastIndexOf('.')) : field;
      const entry = mappedField(mapping, root);
      const valid = kind === 'rank_feature' ? entry?.type === 'rank_features' && entry.positive_score_impact !== false
        : ['byte', 'short', 'integer', 'long', 'unsigned_long', 'half_float', 'float', 'double', 'scaled_float'].includes(entry?.type) && entry.doc_values !== false;
      if (!valid) throw Error('Required scoring field is missing or incompatible: ' + candidate.id + '/' + field);
      if (numericPointsRequired && kind === 'numeric' && (entry.type !== 'float' || entry.index === false)) throw Error('Required utility field lacks float numeric points: ' + candidate.id + '/' + field);
      required.set(kind + ':' + field, { field, kind });
    }
  }
  return { candidateId: candidate.id, index: candidate.index, scope, encoding, numericPointsRequired, docvalueIdRequired,
    ...(pooledMethod ? { transportDefinition: FAVORITE_POOLED_DEFINITION } : {}),
    ...(maximaMethod ? { boundDefinition: FAVORITE_MAXIMA_BOUNDED_DEFINITION } : {}), requiredScoringFields: [...required.values()] };
}

async function inspectIndex(index) {
  const mapping = (await api(index + '/_mapping')).body[index]?.mappings;
  const settings = (await api(index + '/_settings')).body[index]?.settings?.index;
  const stats = (await api(index + '/_stats/docs,indexing,store')).body;
  const primary = stats.indices?.[index]?.primaries;
  if (Number(settings?.number_of_shards) !== 1 || Number(settings?.number_of_replicas) !== 0) throw Error('Expected one primary and zero replicas.');
  return { index, at: new Date().toISOString(), count: (await api(index + '/_count')).body.count, uuid: settings.uuid, mapping, settings, stats,
    mappingHash: hash(canonical(mapping)), metadataHash: hash(canonical(mapping?._meta ?? {})), indexing: { index_total: primary?.indexing?.index_total, delete_total: primary?.indexing?.delete_total } };
}
export async function runOptimizationArrival(config) {
  if (new URL(BASE).port !== '19217') throw Error('Arrival experiment requires isolated port19217.');
  const configBytes = await readFile(config.configFile), artifactBytes = await readFile(config.artifact);
  const candidates = validateFavoriteOptimizationCandidates(JSON.parse(configBytes)), artifact = JSON.parse(artifactBytes);
  const mixedPresets = config.workload.startsWith('presets-'), wide = config.workload.endsWith('wide');
  const selection = selectOptimizationArrivalCandidates(candidates, artifact, { requireAllPresets: mixedPresets }), queries = optimizationArrivalQueries(config.workload);
  if (!selection.selected.length) throw Error('No candidates have complete passing C1 evidence; no arrival campaign can run.');
  const rootSources = await favoriteSourceSnapshot(import.meta.url);
  const { builders, executors, builderSnapshots, executorSnapshots, sources: moduleSources } = await loadOptimizationArrivalModules(selection.selected);
  let sources = mergeArrivalSources(rootSources, moduleSources);
  sources = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
  // Compile every potential request before any load. Historical approval stays
  // bound to the original four bodies; the wider generator has its own current
  // source snapshot and does not change those historical request parameters.
  const queryPlans = selection.selected.flatMap(candidate => compileOptimizationArrivalPlans(candidate, queries, builders.get(candidate.id)));
  const primaryQueryPlans = selection.selected.flatMap(candidate => compileOptimizationArrivalPlans(candidate, optimizationArrivalQueries('fixed'), builders.get(candidate.id)));
  const primaryValidation = selection.selected.map(candidate => validateOptimizationArrivalPrimary({ candidate, artifact, builderSources: builderSnapshots.get(candidate.id), executorSources: executorSnapshots.get(candidate.id), queryPlans: primaryQueryPlans }));
  const presetPrimaryValidation = mixedPresets ? selection.selected.map(candidate => ({ candidateId: candidate.id,
    presets: optimizationArrivalPresetApprovals(candidate, artifact).map(sibling => {
      const queryPlans = compileOptimizationArrivalPlans(sibling, optimizationArrivalQueries('fixed'), builders.get(candidate.id));
      return { presetId: favoritePresetId(sibling.parameters), primaryCandidateId: sibling.id, queryPlans,
        validation: validateOptimizationArrivalPrimary({ candidate: sibling, artifact, builderSources: builderSnapshots.get(candidate.id), executorSources: executorSnapshots.get(candidate.id), queryPlans }) };
    }) })) : undefined;
  const utilityBanks = selection.selected.map(candidate => {
    const plans = queryPlans.filter(plan => plan.candidateId === candidate.id);
    const presets = [...new Map(plans.map(plan => [hash(plan.parameters), plan.parameters])).values()];
    const expectedUtilityKeys = candidate.method.startsWith('favorite-utility-')
      ? createFavoriteUtilityPlan({ presets }).descriptors.map(descriptor => descriptor.key) : [];
    const expected = new Set(expectedUtilityKeys);
    if (expected.size && plans.some(plan => !plan.utilityKeys.length || plan.utilityKeys.some(key => !expected.has(key)))) throw Error('Preflight scoring fields differ from the declared utility bank: ' + candidate.id);
    return { candidateId: candidate.id, scope: 'All256 anchors and23 named features, vibe and0..100% in5% steps, for each preset requested by this workload.',
      expectedUtilityKeys, expectedUtilityKeyCount: expected.size };
  });
  const warmupOrdinals = optimizationArrivalWarmupOrdinals(config.workload, queries.length);
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  await writeFile(path.join(config.directory, 'source-snapshot.json'), JSON.stringify(sources), { flag: 'wx' });
  await writeFile(path.join(config.directory, 'primary-benchmark.json'), artifactBytes, { flag: 'wx' });
  const plan = { experiment: 'favorite-optimization-arrival', configuration: config, configHash: hash(configBytes), primaryArtifactHash: hash(artifactBytes), sourceSnapshotHash: hash(sources), selection, queries, queryPlans, primaryQueryPlans, primaryValidation, utilityBanks,
    ...(wide ? { workloadDefinition: FAVORITE_WIDE_DEFINITION } : {}),
    ...(mixedPresets ? { presetWorkloadDefinition: FAVORITE_PRESET_WORKLOAD, presetPrimaryValidation } : {}),
    warmupPlan: { count: warmupOrdinals.length, queryOrdinals: warmupOrdinals,
      selection: config.workload === 'presets-wide' ? '64 evenly spaced base queries at all9presets, including first and last.' : wide ? 'Evenly spaced across the shuffled workload, including first and last.' : 'Every distinct query.' },
    requestTraversal: 'Each candidate starts at offset0; every scheduled request advances the offset across rate stages, including rejected requests. Warmups do not advance the timed offset.',
    preflight: 'All potential query bodies, merged parameters, scoring fields, encodings and presets are checked before load; compilation and coverage counting for this check are excluded from request timing. Requests still include their own query compilation in timed latency.' };
  await writeFile(path.join(config.directory, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
  const result = { ...plan, planHash: hash(plan), startedAt: new Date().toISOString(), indexBefore: [], indexAfter: [], indexValidation: [], profiles: [], warmups: [], warmupCoverage: [], candidateCoverage: [], skipped: [...selection.omitted],
    latencyBoundary: 'Scheduled arrival through complete decoded OpenSearch response, including scheduler delay, compilation and failures.',
    limitations: ['One node, one primary, no replicas, one shared host; synthetic mixtures of523 sources, not independent million-image corpus.', `${config.durationMs / 1000}-second evenly spaced loads do not prove burst or production capacity.`,
      wide ? `Only${warmupOrdinals.length} queries are explicitly warmed; request cache disabled, other caches uncontrolled. A partial timed traversal does not demonstrate full-bank coverage.` : 'Explicit warmup of every distinct query; request cache disabled, other caches uncontrolled.',
      'Latency percentiles describe the measured mixture, including five-color requests; they do not guarantee latency for each query shape.',
      'Rates stop at the first failed profile; all selected warmups finish and all warmup failures remain in raw evidence.',
      ...(wide ? FAVORITE_WIDE_DEFINITION.limitations : []),
      ...(mixedPresets ? [FAVORITE_PRESET_WORKLOAD.comparisons] : [])] };
  const save = () => atomicJson(path.join(config.directory, 'arrival.json'), result);
  const record = (name, row) => appendFile(path.join(config.directory, name), JSON.stringify(row) + '\n');
  const settle = async () => { if (!(await settleFavoriteActivity()).settled) throw Error('Search/merge activity did not settle.'); };
  await save();
  try {
    for (const index of new Set(selection.selected.map(item => item.index))) {
      const state = await inspectIndex(index); validateFavoriteOptimizationIndex(state, 1000000);
      const original = artifact.indexAfter.find(item => item.index === index);
      if (!original) throw Error('Primary index fingerprint missing.');
      validateFavoriteOptimizationIndex(state, 1000000, original);
      for (const candidate of selection.selected.filter(item => item.index === index)) result.indexValidation.push(validateOptimizationArrivalFields({ candidate, state, queryPlans, workload: config.workload }));
      result.indexBefore.push(state);
    }
    for (const candidate of selection.selected) {
      const candidatePlans = queryPlans.filter(plan => plan.candidateId === candidate.id);
      const expectedUtilityKeys = utilityBanks.find(bank => bank.candidateId === candidate.id).expectedUtilityKeys;
      const coverage = trials => summarizeOptimizationArrivalCoverage({ trials, queryPlans: candidatePlans, expectedUtilityKeys, includePresets: mixedPresets });
      const request = async (queryOffset, includeExecutionEvidence = false) => {
        const item = queries[queryOffset % queries.length];
        return observeOptimizationArrivalRequest(() => executeOptimizationArrivalRequest({ candidate, item, builder: builders.get(candidate.id), executor: executors.get(candidate.id), includeExecutionEvidence }));
      };
      await settle();
      const warmups = await runOptimizationArrivalWarmups({ candidate, queries, queryOrdinals: warmupOrdinals, request,
        record: async row => { result.warmups.push(row); await record('requests.jsonl', row); } });
      result.warmupCoverage.push({ candidateId: candidate.id, ...coverage(warmups) });
      await save();
      if (warmups.some(failed)) { result.skipped.push({ candidateId: candidate.id, rates: config.rates, reason: 'Warmup failed strict limit.' }); await save(); continue; }
      let queryOffset = 0;
      const candidateTrials = [];
      for (const rate of config.rates) {
        await settle(); const before = await favoriteResources(), samples = [before];
        let pendingSample = Promise.resolve(), sampling = false;
        const timer = setInterval(() => { if (sampling) return; sampling = true; pendingSample = favoriteResources().then(sample => { samples.push(sample); return record('resources.jsonl', { candidateId: candidate.id, rate, ...sample }); }).catch(error => { samples.push({ at: new Date().toISOString(), ...favoriteOptimizationFailure(error) }); }).finally(() => { sampling = false; }); }, 1000);
        const startingQueryOffset = queryOffset;
        let measurement; const start = performance.now();
        try { measurement = await runArrivals({ rate, durationMs: config.durationMs, maxInFlight: config.maxInFlight, run: ordinal => request(startingQueryOffset + ordinal) }); }
        finally { clearInterval(timer); await pendingSample; }
        const remainder = config.durationMs - (performance.now() - start); if (remainder > 0) await new Promise(resolve => setTimeout(resolve, remainder));
        const measuredWindowMs = performance.now() - start;
        const trials = measurement.trials.map(row => ({ ...row, candidateId: candidate.id, phase: 'timed', rate,
          ...optimizationArrivalTrialIdentity(candidate, queries, startingQueryOffset + row.ordinal) }));
        queryOffset += trials.length; candidateTrials.push(...trials);
        const profile = await finalizeOptimizationArrivalProfile({ measurement, trials, warmups, before, samples,
          identity: { candidateId: candidate.id, rate, measuredWindowMs, startingQueryOffset, nextQueryOffset: queryOffset,
            coverage: coverage(trials), cumulativeTimedCoverage: coverage(candidateTrials) },
          recordTrials: async rows => { for (const row of rows) await record('requests.jsonl', row); },
          persist: async profile => {
            result.candidateCoverage = result.candidateCoverage.filter(item => item.candidateId !== candidate.id);
            result.candidateCoverage.push({ candidateId: candidate.id, ...profile.cumulativeTimedCoverage });
            result.profiles.push(profile); await save();
          },
        });
        console.log(JSON.stringify({ candidateId: candidate.id, rate, requests: trials.length, p95Ms: profile.p95Ms, maxMs: profile.maxMs, strictFailures: profile.strictFailures }));
        if (!profile.viableAtTestedLoad) { result.skipped.push({ candidateId: candidate.id, rates: config.rates.filter(value => value > rate), reason: 'Strict profile failure; higher rates omitted.' }); await save(); break; }
      }
    }
    await settle();
    for (const previous of result.indexBefore) { const state = await inspectIndex(previous.index); validateFavoriteOptimizationIndex(state, 1000000, previous); result.indexAfter.push(state); }
    let afterSources = await favoriteSourceSnapshot(import.meta.url);
    for (const candidate of selection.selected) {
      afterSources = mergeArrivalSources(afterSources, await favoriteSourceSnapshot(new URL(candidate.builder.module, import.meta.url)));
      if (candidate.executor) afterSources = mergeArrivalSources(afterSources, await favoriteSourceSnapshot(new URL(candidate.executor.module, import.meta.url)));
    }
    afterSources = Object.fromEntries(Object.entries(afterSources).sort(([a], [b]) => a.localeCompare(b)));
    if (hash(afterSources) !== hash(sources) || hash(await readFile(config.configFile)) !== hash(configBytes)) throw Error('Source/config changed during arrival campaign.');
    result.finishedAt = new Date().toISOString(); await save(); return result;
  } catch (error) { result.interruption = { at: new Date().toISOString(), ...favoriteOptimizationFailure(error), stack: error.stack ?? String(error) }; await save(); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runOptimizationArrival(optimizationArrivalConfiguration(process.argv.slice(2)));
