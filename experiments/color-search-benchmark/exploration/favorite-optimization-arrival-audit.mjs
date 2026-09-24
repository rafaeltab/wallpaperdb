// Independent, file-only arrival evidence audit. No imports from the arrival
// coordinator, scheduler, scorer, query builder or metric implementation.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const bad = row => Boolean(row.error) || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0 || row.elapsedMs >= 1000;
const percentile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null;
const fixedIds = ['picked-one-vibe', 'picked-one-green40', 'picked-two-portions', 'picked-five-portions'];
// Independent literals: do not import the workload generator or its preset table.
const presets = [0, .5, 1].flatMap(qualityInfluence => [0, 1, 3].map(cutoffBlendExponent => ({
  id: `q${String(qualityInfluence * 100).padStart(3, '0')}_w${cutoffBlendExponent}`,
  parameters: { qualityInfluence, cutoffBlendExponent },
})));

export function independentlySummarizeOptimizationArrivals(trials, warmups = []) {
  const latencies = trials.map(row => row.elapsedMs), strictTimedFailures = trials.filter(bad).length, strictWarmupFailures = warmups.filter(bad).length;
  return { requests: trials.length, errors: trials.filter(row => Boolean(row.error)).length,
    clientRejected: trials.filter(row => Boolean(row.clientRejected)).length, overOneSecond: trials.filter(row => row.elapsedMs >= 1000).length,
    p50Ms: percentile(latencies, .5), p95Ms: percentile(latencies, .95), p99Ms: percentile(latencies, .99), maxMs: percentile(latencies, 1),
    maximumSchedulerDelayMs: percentile(trials.map(row => row.schedulerDelayMs), 1), strictTimedFailures, strictWarmupFailures,
    strictFailures: strictTimedFailures + strictWarmupFailures, warmupErrors: warmups.filter(row => Boolean(row.error)).length,
    warmupOverOneSecond: warmups.filter(row => row.elapsedMs >= 1000).length,
    viableAtTestedLoad: trials.length > 0 && strictTimedFailures === 0 && strictWarmupFailures === 0 };
}

function fieldsFromBody(body) {
  const fields = new Set();
  const scan = value => {
    if (!value || typeof value !== 'object') return;
    for (const field of [value.field_value_factor?.field, value.rank_feature?.field]) if (typeof field === 'string') fields.add(field);
    for (const nested of Object.values(value)) scan(nested);
  };
  scan(body?.query);
  for (const entry of body?.sort ?? []) if (entry && typeof entry === 'object') for (const field of Object.keys(entry)) if (field.startsWith('utilities.')) fields.add(field);
  return [...fields];
}
function utilityKeys(body) {
  return [...new Set(fieldsFromBody(body).flatMap(field => {
    if (field.startsWith('utilities.')) return [field.substring(10)];
    const match = /^utility_(rank8|rank16|rankfloat|rank18|rank27)_q\d+_w\d+\.(.+)$/.exec(field);
    if (!match) return [];
    return [match[1] === 'rank16' ? match[2].replace(/_(hi|lo)$/, '')
      : ['rank18', 'rank27'].includes(match[1]) ? match[2].replace(/_d[012]$/, '') : match[2]];
  }))].sort();
}

export function independentlyCountPresetCoverage(trials, plans) {
  const byId = new Map(plans.map(plan => [plan.queryId, plan]));
  return presets.map(preset => {
    const rows = trials.filter(row => {
      const plan = byId.get(row.queryId);
      if (!plan || row.queryOrdinal !== plan.queryOrdinal || !same(row.parameters, plan.parameters)) throw Error('Preset coverage request identity differs.');
      return plan.parameters.qualityInfluence === preset.parameters.qualityInfluence && plan.parameters.cutoffBlendExponent === preset.parameters.cutoffBlendExponent;
    });
    const returned = rows.filter(row => !row.clientRejected && !row.error && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0);
    const keys = new Set(returned.flatMap(row => utilityKeys(byId.get(row.queryId).body)));
    if ([...keys].some(key => !key.endsWith('_' + preset.id))) throw Error('Preset coverage fields differ from parameters.');
    return { presetId: preset.id, parameters: preset.parameters,
      scheduledRequests: rows.length, dispatchedRequests: rows.filter(row => !row.clientRejected).length,
      successfulRequests: returned.length, withinBudgetRequests: rows.filter(row => !row.clientRejected && !bad(row)).length,
      errors: rows.filter(row => row.error).length, atOrAboveOneSecond: rows.filter(row => row.elapsedMs >= 1000).length,
      strictFailures: rows.filter(row => row.clientRejected || bad(row)).length,
      successfulQueryCount: new Set(returned.map(row => row.queryId)).size, successfulUtilityKeyCount: keys.size,
      expectedUtilityKeyCount: 6138, fullUtilityBankCovered: keys.size === 6138 };
  });
}

export function independentlyCountArrivalCoverage(trials, plans, expectedKeys = [], includePresets = false) {
  const byId = new Map(plans.map(plan => [plan.queryId, plan])), expected = new Set(expectedKeys);
  const count = rows => {
    const ids = new Set(), keys = new Set(), targetCounts = {}, modes = {};
    for (const row of rows) {
      const plan = byId.get(row.queryId);
      if (!plan) throw Error('Unknown query in coverage evidence: ' + row.queryId);
      ids.add(row.queryId);
      for (const key of utilityKeys(plan.body)) keys.add(key);
      targetCounts[plan.targetCount] = (targetCounts[plan.targetCount] ?? 0) + 1;
      modes[plan.mode] = (modes[plan.mode] ?? 0) + 1;
    }
    return { requests: rows.length, distinctQueryCount: ids.size, queryIds: [...ids].sort(), targetCounts, modes,
      utilityKeyCount: keys.size, utilityKeys: [...keys].sort(), utilityKeyFraction: expected.size ? keys.size / expected.size : null,
      fullUtilityBankCovered: expected.size > 0 && keys.size === expected.size && [...keys].every(key => expected.has(key)) };
  };
  return { workloadQueryCount: plans.length, expectedUtilityKeyCount: expected.size, utilityCoverageAvailable: expected.size > 0,
    firstQueryOffset: trials.length ? trials[0].queryOffset : null, nextQueryOffset: trials.length ? trials.at(-1).queryOffset + 1 : null,
    scheduled: count(trials), dispatched: count(trials.filter(row => !row.clientRejected)),
    successful: count(trials.filter(row => !row.clientRejected && !row.error && Number.isFinite(row.elapsedMs))),
    ...(includePresets ? { presets: independentlyCountPresetCoverage(trials, plans) } : {}) };
}

// Independent literal binding for this one executor. Do not import the scorer
// or accept similarly named methods as equivalent execution definitions.
export function independentlyAuditMaximaArrivalBinding({ candidate, state, validation, warmups }) {
  const errors = [], require = (condition, message) => { if (!condition) errors.push(message); };
  require(candidate?.method === 'favorite-utility-maxima-bounded', 'Unexpected maxima method.');
  require(candidate?.builder?.module === './favorite-maxima-bounded-utilities.mjs' && candidate.builder.export === 'buildFavoriteMaximaBoundedQuery'
    && candidate.executor?.module === './favorite-maxima-bounded-utilities.mjs' && candidate.executor.export === 'executeFavoriteMaximaBoundedUtilitySearch', 'Maxima builder/executor differs.');
  const mapping = state?.mapping, fields = Object.values(mapping?.properties?.utilities?.properties ?? {});
  require(mapping?._meta?.numericPoints === true && mapping._meta.encodings?.includes('numeric') && fields.length > 0
    && fields.every(field => field.type === 'float' && field.index !== false && field.doc_values !== false), 'Maxima index lacks numeric float points/doc values.');
  require(mapping?.properties?.id?.type === 'keyword' && mapping.properties.id.doc_values !== false, 'Maxima ID doc values are unavailable.');
  require(validation?.encoding === 'numeric' && validation.numericPointsRequired === true && validation.docvalueIdRequired === true
    && validation.boundDefinition?.version === 1 && validation.boundDefinition.parentMethod === 'favorite-utility-bounded', 'Maxima preflight definition differs.');
  for (const row of warmups ?? []) if (!row.error) {
    const evidence = row.executionEvidence, stages = evidence?.stages?.map(stage => stage.phase) ?? [];
    require(stages[0] === 'pit-open' && stages.includes('global-final') && stages.at(-1) === 'pit-close'
      && evidence?.globalBounds?.maximaBounds && Array.isArray(evidence.globalBounds.maximaBounds.thresholds), 'Successful maxima warmup lacks executor stage/bound evidence.');
  }
  return errors;
}

export function independentlyAuditPooledArrivalBinding({ candidate, state, validation, warmups }) {
  const errors = [], require = (condition, message) => { if (!condition) errors.push(message); };
  const parents = { 'favorite-utility-bounded-pooled-delete': 'favorite-utility-bounded',
    'favorite-utility-maxima-bounded-pooled-delete': 'favorite-utility-maxima-bounded' };
  const parent = parents[candidate?.method], maxima = parent === 'favorite-utility-maxima-bounded';
  require(Boolean(parent), 'Unexpected pooled method.');
  require(candidate?.builder?.module === './favorite-pooled-utilities.mjs' && candidate.builder.export === 'buildFavoritePooledQuery'
    && candidate.executor?.module === './favorite-pooled-utilities.mjs' && candidate.executor.export === 'executeFavoritePooledUtilitySearch', 'Pooled builder/executor differs.');
  const mapping = state?.mapping, fields = Object.values(mapping?.properties?.utilities?.properties ?? {});
  require(mapping?._meta?.numericPoints === true && mapping._meta.encodings?.includes('numeric') && fields.length > 0
    && fields.every(field => field.type === 'float' && field.index !== false && field.doc_values !== false), 'Pooled index lacks numeric float points/doc values.');
  require(mapping?.properties?.id?.type === 'keyword' && mapping.properties.id.doc_values !== false, 'Pooled ID doc values are unavailable.');
  require(validation?.encoding === 'numeric' && validation.numericPointsRequired === true && validation.docvalueIdRequired === true
    && validation.transportDefinition?.version === 1 && validation.transportDefinition.transport?.version === 1
    && validation.transportDefinition.transport.kind === 'favorite-pooled-pit-delete' && validation.transportDefinition.transport.retries === 0,
  'Pooled preflight transport definition differs.');
  if (maxima) require(validation?.boundDefinition?.version === 1 && validation.boundDefinition.parentMethod === 'favorite-utility-bounded', 'Pooled maxima definition differs.');
  for (const row of warmups ?? []) if (!row.error) {
    const evidence = row.executionEvidence, stages = evidence?.stages?.map(stage => stage.phase) ?? [], transport = evidence?.transport;
    require(evidence?.method === candidate.method && evidence.parentMethod === parent && stages[0] === 'pit-open'
      && stages.includes('global-final') && stages.at(-1) === 'pit-close', 'Successful pooled warmup lacks executor stage evidence.');
    require(transport?.kind === 'favorite-pooled-pit-delete' && transport.version === 1 && transport.nativeDeleteRequests === 1
      && transport.nativeDeleteResponses === 1 && transport.attempts === 1 && [0, 1].includes(transport.reusedConnections), 'Successful pooled warmup lacks actual no-retry native cleanup witness.');
    if (maxima) require(Array.isArray(evidence?.globalBounds?.maximaBounds?.thresholds), 'Successful pooled maxima warmup lacks bound evidence.');
  }
  return errors;
}

/** Internal consistency is independent of performance success: a complete
 * campaign that exposes a slow method can still have accepted evidence. */
export function auditOptimizationArrivalEvidence({ plan, result, sources, primary, primaryBytes, rawRequests }) {
  const errors = []; let errorCount = 0;
  const require = (condition, message) => { if (!condition) { errorCount++; if (errors.length < 200) errors.push(message); } };
  const compare = (actual, expected, label) => { for (const [key, value] of Object.entries(expected)) require(same(actual?.[key], value), label + ': ' + key); };
  const complete = typeof result?.finishedAt === 'string' && Number.isFinite(Date.parse(result.finishedAt)) && !result.interruption;
  const candidates = plan.selection?.selected ?? [], queries = plan.queries ?? [], profiles = result.profiles ?? [], warmups = result.warmups ?? [];
  const config = plan.configuration ?? {}, planned = plan.queryPlans ?? [];
  const mixedPresets = ['presets-fixed', 'presets-varied', 'presets-wide'].includes(config.workload);
  const baseWorkload = mixedPresets ? config.workload.slice('presets-'.length) : config.workload;
  try {
    require(plan.experiment === 'favorite-optimization-arrival', 'Unknown arrival experiment.');
    require(hash(plan) === result.planHash, 'Archived planHash differs.');
    compare(result, plan, 'Checkpoint differs from archived plan');
    require(hash(sources) === plan.sourceSnapshotHash, 'Archived sourceSnapshotHash differs.');
    require(hash(primaryBytes) === plan.primaryArtifactHash && same(JSON.parse(primaryBytes), primary), 'Archived primary artifact hash/content differs.');
    require(primary.experiment === 'favorite-optimization-benchmark' && primary.configuration?.count === 1000000 && Boolean(primary.finishedAt) && !primary.interruption, 'Require complete million-record primary evidence.');
    require(candidates.length > 0 && new Set(candidates.map(candidate => candidate.id)).size === candidates.length, 'No selected candidates or duplicate IDs.');
    require(queries.length > 0 && new Set(queries.map(query => query.id)).size === queries.length, 'No workload queries or duplicate IDs.');
    require(['fixed', 'varied', 'wide', 'presets-fixed', 'presets-varied', 'presets-wide'].includes(config.workload), 'Unknown workload mode.');
    require(Number.isInteger(config.durationMs / 1000) && config.durationMs >= 1000 && config.durationMs <= (config.workload === 'presets-wide' ? 1800000 : 600000)
      && config.limit === 20 && config.maxInFlight === 128 && config.serviceTimeoutMs === 950 && config.clientTimeoutMs === 1500, 'Arrival timing/limit protocol changed.');
    require(Array.isArray(config.rates) && config.rates.length && config.rates.every((rate, i) => Number.isInteger(rate) && rate >= 1 && rate <= 512 && (!i || rate > config.rates[i - 1])), 'Invalid arrival rates.');
    const baseQueries = mixedPresets ? queries.filter((_, i) => i % 9 === 0) : queries;
    if (baseWorkload === 'fixed') require(same(baseQueries.map(query => mixedPresets ? query.baseQueryId : query.id), fixedIds), 'Fixed query list differs.');
    if (baseWorkload === 'varied') require(baseQueries.length === 75, 'Varied query count differs.');
    if (baseWorkload === 'wide') require(baseQueries.length === 8184 && baseQueries.filter(query => query.kind === 'coverage').length === 6138 && baseQueries.filter(query => query.kind === 'combination').length === 2046, 'Wide query inventory differs.');
    if (mixedPresets) {
      require(plan.presetWorkloadDefinition?.version === 1 && same(plan.presetWorkloadDefinition.presets, presets)
        && plan.presetWorkloadDefinition.utilityKeys === 55242 && queries.length === baseQueries.length * 9, 'Preset workload definition differs.');
      for (const [i, item] of queries.entries()) {
        const base = baseQueries[Math.floor(i / 9)], preset = presets[i % 9];
        const stripPreset = parameters => Object.fromEntries(Object.entries(parameters ?? {}).filter(([key]) => !['qualityInfluence', 'cutoffBlendExponent'].includes(key)));
        require(item.presetId === preset.id && item.baseQueryId === base.baseQueryId && item.id === preset.id + '--' + base.baseQueryId
          && item.parameters?.qualityInfluence === preset.parameters.qualityInfluence && item.parameters?.cutoffBlendExponent === preset.parameters.cutoffBlendExponent
          && same(item.query, base.query) && same(item.filter ?? null, base.filter ?? null) && same(item.selectivity ?? null, base.selectivity ?? null)
          && same(stripPreset(item.parameters), stripPreset(base.parameters)), 'Preset traversal, base query or controls differ: ' + item.id);
      }
    }
    const selectedBaseCount = baseWorkload === 'wide' ? Math.min(64, baseQueries.length) : baseQueries.length;
    const baseOrdinals = Array.from({ length: selectedBaseCount }, (_, i) => selectedBaseCount === 1 ? 0 : Math.floor(i * (baseQueries.length - 1) / (selectedBaseCount - 1)));
    const warmOrdinals = mixedPresets ? baseOrdinals.flatMap(i => presets.map((_, j) => i * 9 + j)) : baseOrdinals;
    const warmCount = warmOrdinals.length;
    require(plan.warmupPlan?.count === warmCount && same(plan.warmupPlan?.queryOrdinals, warmOrdinals), 'Warmup selection/count differs.');
    require(planned.length === candidates.length * queries.length, 'Preflight query-plan count differs.');

    function graph(binding) {
      const found = new Set(), queue = [path.posix.normalize(path.posix.join('exploration', binding.module))];
      while (queue.length) {
        const file = queue.pop(); if (found.has(file)) continue; found.add(file);
        const text = sources[file]; require(typeof text === 'string', 'Missing archived recursive source: ' + file);
        if (typeof text !== 'string') continue;
        require(primary.sourceHashes?.[file] === hash(text), 'Primary recursive source differs: ' + file);
        for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
          if (/\.(?:mjs|js|json)$/.test(match[1])) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
        }
      }
      return [...found].sort();
    }

    const expectedRaw = new Map(), candidateIds = new Set(candidates.map(candidate => candidate.id));
    const rawKey = row => `${row.candidateId}:${row.phase}:${row.phase === 'timed' ? row.rate : ''}:${row.ordinal}`;
    const successful = row => {
      if (!row.error && !row.clientRejected) require(row.hitCount === 20 && typeof row.hitsHash === 'string' && /^[0-9a-f]{64}$/.test(row.hitsHash), 'Successful row lacks global top20/hit hash.');
      require(Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0 && Number.isFinite(row.schedulerDelayMs) && row.schedulerDelayMs >= 0, 'Invalid request timing.');
      if (row.clientRejected) require(Boolean(row.error), 'Client rejection must remain an error.');
    };
    function requestIdentity(row, candidate, ordinal, offset, phase, rate) {
      const queryOrdinal = offset % queries.length, item = queries[queryOrdinal];
      require(row.candidateId === candidate.id && row.ordinal === ordinal && row.queryOffset === offset && row.queryOrdinal === queryOrdinal && row.queryId === item.id && row.phase === phase, 'Request query/offset/ordinal identity differs.');
      require(same(row.parameters, { ...candidate.parameters, ...item.parameters }), 'Merged request parameters differ.');
      if (phase === 'timed') require(row.rate === rate, 'Request rate differs.');
      successful(row);
      const key = rawKey(row); require(!expectedRaw.has(key), 'Duplicate checkpoint request: ' + key); expectedRaw.set(key, row);
    }

    for (const candidate of candidates) {
      require(same(candidate, primary.candidates?.find(item => item.id === candidate.id)), 'Primary candidate identity differs: ' + candidate.id);
      const builderFiles = graph(candidate.builder), executorFiles = candidate.executor ? graph(candidate.executor) : [];
      const binding = plan.primaryValidation?.find(row => row.candidateId === candidate.id);
      require(binding && same([...new Set([...builderFiles, ...executorFiles])].sort(), [...(binding.sourceFiles ?? [])].sort()) && same(executorFiles, [...(binding.executorSourceFiles ?? [])].sort()), 'Primary source inventory binding differs: ' + candidate.id);
      for (const queryId of fixedIds) {
        const saved = primary.queryPlans?.filter(row => row.candidateId === candidate.id && row.caseId === candidate.id + ':' + queryId) ?? [];
        const current = plan.primaryQueryPlans?.filter(row => row.candidateId === candidate.id && row.queryId === queryId) ?? [];
        require(saved.length === 1 && current.length === 1, 'Fixed primary query-plan inventory differs: ' + queryId);
        if (saved.length && current.length) {
          require(saved[0].index === candidate.index && saved[0].bodyHash === hash(saved[0].body) && same(saved[0].body, current[0].body), 'Fixed primary query body differs: ' + queryId);
          require(same(saved[0].executor ?? null, candidate.executor ?? null), 'Primary executor binding differs.');
          require(binding?.verifiedPlans?.some(row => row.queryId === queryId && row.bodyHash === saved[0].bodyHash), 'Missing fixed query verification binding.');
        }
        const approval = primary.profiles?.filter(row => row.candidateId === candidate.id && row.queryId === queryId && row.selectivity === 'all' && row.concurrency === 1) ?? [];
        const primaryWarmups = (primary.warmups ?? []).filter(row => row.candidateId === candidate.id && row.caseId === candidate.id + ':' + queryId).flatMap(row => row.trials ?? []);
        require(approval.length === 1 && approval.every(row => row.viableAtTestedLoad === true && row.minimumRequests >= 32 && row.requestedDurationMs >= 10000 && row.elapsedMs >= 10000 && row.trials?.length >= 32 && row.trials.every(trial => !bad(trial))) && primaryWarmups.length > 0 && primaryWarmups.every(row => !bad(row)), 'Primary C1 approval fails strict evidence: ' + candidate.id + ':' + queryId);
      }
      if (mixedPresets) {
        const presetBindings = plan.presetPrimaryValidation?.find(row => row.candidateId === candidate.id)?.presets ?? [];
        require(presetBindings.length === 9 && new Set(presetBindings.map(row => row.presetId)).size === 9, 'Preset primary binding inventory differs.');
        for (const preset of presets) {
          const matches = (primary.candidates ?? []).filter(item => item.method === candidate.method && item.index === candidate.index
            && same(item.builder, candidate.builder) && same(item.executor ?? null, candidate.executor ?? null)
            && same(item.parameters, { ...candidate.parameters, ...preset.parameters }));
          const record = presetBindings.find(row => row.presetId === preset.id), sibling = matches[0];
          require(matches.length === 1 && record?.primaryCandidateId === sibling?.id, 'Preset primary candidate identity differs: ' + preset.id);
          if (!sibling || !record) continue;
          require(record.validation?.candidateId === sibling.id && same(record.validation.sourceFiles, binding?.sourceFiles)
            && same(record.validation.executorSourceFiles, binding?.executorSourceFiles) && record.queryPlans?.length === 4, 'Preset primary source or plan binding differs: ' + preset.id);
          for (const queryId of fixedIds) {
            const saved = (primary.queryPlans ?? []).filter(row => row.candidateId === sibling.id && row.caseId === sibling.id + ':' + queryId);
            const current = (record.queryPlans ?? []).filter(row => row.candidateId === sibling.id && row.queryId === queryId);
            require(saved.length === 1 && current.length === 1 && saved[0].index === candidate.index && saved[0].bodyHash === hash(saved[0].body)
              && same(saved[0].body, current[0].body) && same(saved[0].executor ?? null, candidate.executor ?? null)
              && record.validation.verifiedPlans?.some(row => row.queryId === queryId && row.bodyHash === saved[0].bodyHash), 'Preset fixed primary query body differs: ' + preset.id + '/' + queryId);
            const approval = (primary.profiles ?? []).filter(row => row.candidateId === sibling.id && row.queryId === queryId && row.selectivity === 'all' && row.concurrency === 1);
            const warm = (primary.warmups ?? []).filter(row => row.candidateId === sibling.id && row.caseId === sibling.id + ':' + queryId).flatMap(row => row.trials ?? []);
            require(approval.length === 1 && approval.every(row => row.viableAtTestedLoad === true && row.minimumRequests >= 32 && row.requestedDurationMs >= 10000
              && row.elapsedMs >= 10000 && row.trials?.length >= 32 && row.trials.every(trial => !bad(trial))) && warm.length > 0 && warm.every(row => !bad(row)), 'Preset C1 approval fails strict evidence: ' + preset.id + '/' + queryId);
          }
        }
      }
      const plans = planned.filter(row => row.candidateId === candidate.id), bank = plan.utilityBanks?.find(row => row.candidateId === candidate.id);
      const plansById = new Map(plans.map(row => [row.queryId, row]));
      require(plans.length === queries.length && new Set(plans.map(row => row.queryId)).size === queries.length, 'Candidate preflight inventory differs.');
      require(bank && bank.expectedUtilityKeyCount === new Set(bank.expectedUtilityKeys).size, 'Utility-bank key inventory differs.');
      const expectedKeys = bank?.expectedUtilityKeys ?? [], expectedKeySet = new Set(expectedKeys), allKeys = new Set();
      for (const [i, item] of queries.entries()) {
        const queryPlan = plansById.get(item.id);
        require(queryPlan && queryPlan.queryOrdinal === i && queryPlan.targetCount === item.query.targets.length && queryPlan.mode === item.query.mode && same(queryPlan.parameters, { ...candidate.parameters, ...item.parameters }), 'Preflight query identity/parameters differ: ' + item.id);
        if (!queryPlan) continue;
        require(queryPlan.body?.size === 20 && queryPlan.body?.timeout === '950ms' && !queryPlan.body?.profile, 'Preflight query timing/limit differs.');
        const actualKeys = utilityKeys(queryPlan.body); require(same(actualKeys, queryPlan.utilityKeys), 'Preflight utility keys differ from actual scoring fields.');
        actualKeys.forEach(key => allKeys.add(key));
      }
      require([...allKeys].every(key => expectedKeySet.has(key)), 'Compiled workload contains keys outside its declared utility bank.');
      if (baseWorkload === 'wide' && candidate.method.startsWith('favorite-utility-')) require(expectedKeys.length === (mixedPresets ? 55242 : 6138) && same([...allKeys].sort(), [...expectedKeys].sort()), 'Wide preflight does not cover the declared favorite utilities.');

      const warm = warmups.filter(row => row.candidateId === candidate.id);
      if (candidate.method === 'favorite-utility-maxima-bounded') for (const error of independentlyAuditMaximaArrivalBinding({ candidate,
        state: result.indexBefore?.find(row => row.index === candidate.index),
        validation: result.indexValidation?.find(row => row.candidateId === candidate.id), warmups: warm })) require(false, error);
      if (['favorite-utility-bounded-pooled-delete', 'favorite-utility-maxima-bounded-pooled-delete'].includes(candidate.method)) for (const error of independentlyAuditPooledArrivalBinding({ candidate,
        state: result.indexBefore?.find(row => row.index === candidate.index),
        validation: result.indexValidation?.find(row => row.candidateId === candidate.id), warmups: warm })) require(false, error);
      if (complete) require(warm.length === warmCount, 'Incomplete warmup inventory: ' + candidate.id);
      warm.forEach((row, i) => requestIdentity(row, candidate, i, warmOrdinals[i], 'warmup'));
      if (warm.length) compare(result.warmupCoverage?.find(row => row.candidateId === candidate.id), independentlyCountArrivalCoverage(warm, plans, expectedKeys, mixedPresets), 'Warmup coverage differs');
      let offset = 0, failedEarlier = warm.some(bad); const cumulative = [];
      for (const rate of config.rates) {
        const measured = profiles.filter(row => row.candidateId === candidate.id && row.rate === rate);
        const skipped = (result.skipped ?? []).filter(row => row.candidateId === candidate.id && row.rates?.includes(rate));
        require(measured.length <= 1 && skipped.length <= 1 && !(measured.length && skipped.length), 'Duplicate or measured-and-skipped rate.');
        if (complete) require(measured.length + skipped.length === 1, 'Completed campaign has an unaccounted rate.');
        if (skipped.length) require(failedEarlier, 'Rate skipped without an earlier strict failure.');
        if (!measured.length) continue;
        require(!failedEarlier, 'Rate measured after strict warmup/profile failure.');
        const profile = measured[0], trials = profile.trials ?? [];
        require(trials.length === Math.floor(rate * config.durationMs / 1000), 'Scheduled request count differs.');
        require(profile.startingQueryOffset === offset && profile.nextQueryOffset === offset + trials.length, 'Rate traversal offset restarted or skipped.');
        // setTimeout may wake slightly before the end-of-window padding. The
        // scheduler's fixed request count still requires the last arrival slot.
        const lastScheduledMs = Math.max(0, trials.length - 1) * 1000 / rate;
        require(profile.durationMs === config.durationMs && profile.maxInFlight === config.maxInFlight
          && Number.isInteger(profile.peakInFlight) && profile.peakInFlight >= 0 && profile.peakInFlight <= config.maxInFlight
          && Number.isFinite(profile.elapsedMs) && profile.elapsedMs >= lastScheduledMs
          && Number.isFinite(profile.measuredWindowMs) && profile.measuredWindowMs >= lastScheduledMs, 'Measured window/concurrency differs.');
        trials.forEach((row, i) => requestIdentity(row, candidate, i, offset + i, 'timed', rate));
        const recomputed = independentlySummarizeOptimizationArrivals(trials, warm);
        if (profile.finalResourceCollectionComplete === false) {
          require(!complete && Boolean(result.interruption) && profile.measurementComplete === true && profile.after === null
            && profile.cpuMs === null && profile.clientCpuMs === null && profile.resourceErrors >= 1 && typeof profile.resourceCollectionError?.error === 'string',
          'Incomplete final resource evidence cannot qualify or invent CPU deltas.');
          recomputed.viableAtTestedLoad = false;
        }
        compare(profile, recomputed, 'Profile counters/percentiles differ');
        cumulative.push(...trials);
        compare(profile.coverage, independentlyCountArrivalCoverage(trials, plans, expectedKeys, mixedPresets), 'Rate coverage differs');
        compare(profile.cumulativeTimedCoverage, independentlyCountArrivalCoverage(cumulative, plans, expectedKeys, mixedPresets), 'Cumulative timed coverage differs');
        offset += trials.length; failedEarlier ||= trials.some(bad) || profile.finalResourceCollectionComplete === false;
      }
      if (cumulative.length) compare(result.candidateCoverage?.find(row => row.candidateId === candidate.id), independentlyCountArrivalCoverage(cumulative, plans, expectedKeys, mixedPresets), 'Final candidate coverage differs');
    }
    const seenRaw = new Set(); let pendingRawRows = 0;
    for (const row of rawRequests) {
      const key = rawKey(row); require(!seenRaw.has(key), 'Duplicate raw request: ' + key); seenRaw.add(key);
      require(candidateIds.has(row.candidateId) && ['warmup', 'timed'].includes(row.phase), 'Unknown raw candidate or phase.');
      if (expectedRaw.has(key)) require(same(row, expectedRaw.get(key)), 'Raw request/checkpoint row differs: ' + key);
      else { pendingRawRows++; if (complete) require(false, 'Raw request missing from completed checkpoint: ' + key); }
    }
    for (const key of expectedRaw.keys()) require(seenRaw.has(key), 'Checkpoint request missing from raw evidence: ' + key);
    for (const profile of profiles) require(candidateIds.has(profile.candidateId) && config.rates.includes(profile.rate), 'Unknown profile candidate/rate.');
    for (const row of warmups) require(candidateIds.has(row.candidateId), 'Unknown warmup candidate.');

    const indexes = [...new Set(candidates.map(candidate => candidate.index))].sort();
    require(same((result.indexBefore ?? []).map(state => state.index).sort(), indexes), 'Initial index inventory differs.');
    if (complete) require(same((result.indexAfter ?? []).map(state => state.index).sort(), indexes), 'Final index inventory differs.');
    for (const state of [...(result.indexBefore ?? []), ...(result.indexAfter ?? [])]) {
      require(state.count === 1000000 && state.uuid && state.mappingHash === hash(canonical(state.mapping)) && state.metadataHash === hash(canonical(state.mapping?._meta ?? {})), 'Index mapping/count fingerprint is invalid.');
      const previous = primary.indexAfter?.find(row => row.index === state.index);
      require(previous, 'Primary final index fingerprint missing.');
      for (const key of ['count', 'uuid', 'mappingHash', 'metadataHash', 'indexing']) require(same(state[key], previous?.[key]), 'Index generation differs from primary: ' + key);
      if (config.workload !== 'fixed') require((state.mapping?._meta?.scope ?? state.mapping?._meta?.identity?.scope) === 'full', 'Varied/wide workload requires full schema.');
    }
    return { schemaVersion: 1, experiment: 'favorite-optimization-arrival-audit', complete, integrityPassed: errorCount === 0,
      accepted: complete && errorCount === 0, errorCount, errors, profileCount: profiles.length,
      failedProfiles: profiles.filter(profile => !profile.viableAtTestedLoad).length, rawRequestRows: rawRequests.length, pendingRawRows,
      incompleteResourceProfiles: profiles.filter(profile => profile.finalResourceCollectionComplete === false).length,
      hashes: { plan: hash(plan), result: hash(result), archivedSources: hash(sources), primary: hash(primaryBytes) },
      limitations: ['Offline internal-consistency audit; no service queries or independent re-execution of ranking.',
        'Source hashes and recursive local import bindings are checked against the archived primary artifact; current worktree changes are irrelevant.',
        'Successful coverage proves which compiled fields were requested in returned rankings, not how many documents or posting blocks OpenSearch visited.',
        'Incomplete campaigns are never accepted. Failed performance profiles can still have accepted, fully preserved evidence.'] };
  } catch (error) {
    require(false, 'Malformed evidence: ' + error.message);
    return { schemaVersion: 1, experiment: 'favorite-optimization-arrival-audit', complete, accepted: false, integrityPassed: false,
      errorCount, errors, profileCount: profiles.length, rawRequestRows: rawRequests?.length ?? 0 };
  }
}

export async function auditOptimizationArrival(directory) {
  const read = async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'));
  const [plan, result, sources] = await Promise.all(['plan.json', 'arrival.json', 'source-snapshot.json'].map(read));
  const primaryBytes = await readFile(path.join(directory, 'primary-benchmark.json'), 'utf8'), rawRequests = [];
  for await (const line of createInterface({ input: createReadStream(path.join(directory, 'requests.jsonl')), crlfDelay: Infinity })) {
    if (!line.trim()) throw Error('Blank raw request row.'); rawRequests.push(JSON.parse(line));
  }
  return { ...auditOptimizationArrivalEvidence({ plan, result, sources, primaryBytes, primary: JSON.parse(primaryBytes), rawRequests }), directory: path.resolve(directory), auditedAt: new Date().toISOString() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (key === '--allow-incomplete') options.allowIncomplete = true;
    else if (['--directory', '--output'].includes(key) && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) options[key.slice(2)] = process.argv[++i];
    else throw Error('Use --directory and optional --output / --allow-incomplete.');
  }
  if (!options.directory) throw Error('Provide an archived arrival directory.');
  const result = await auditOptimizationArrival(path.resolve(options.directory));
  if (options.output) await writeFile(path.resolve(options.output), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
  if (!result.integrityPassed) process.exitCode = 1;
  else if (!result.complete && !options.allowIncomplete) process.exitCode = 2;
}
