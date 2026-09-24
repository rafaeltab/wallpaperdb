import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizationArrivalConfiguration, optimizationArrivalQueries, selectOptimizationArrivalCandidates, summarizeOptimizationArrival,
  validateOptimizationArrivalPrimary, validateOptimizationArrivalFields } from './favorite-optimization-arrival.mjs';
import { loadOptimizationArrivalModules, executeOptimizationArrivalRequest } from './favorite-optimization-arrival.mjs';
import { optimizationArrivalItem, compileOptimizationArrivalPlans, optimizationArrivalWarmupOrdinals,
  optimizationArrivalTrialIdentity, summarizeOptimizationArrivalCoverage, runOptimizationArrivalWarmups } from './favorite-optimization-arrival.mjs';
import { buildFavoriteUtilityQuery, createFavoriteUtilityPlan, favoriteUtilityMapping } from './favorite-utilities.mjs';
import { buildFavoritePrecisionQuery, favoritePrecisionMapping } from './favorite-precision-utilities.mjs';
import { compileFavoriteOptimizationQuery } from './favorite-optimization-benchmark.mjs';
import { hash } from './service.mjs';
import { FAVORITE_PARAMETERS } from './favorite-scale-corpus.mjs';
import { favoriteCompiledMapping } from './favorite-compiled-index.mjs';
import { FAVORITE_DOCVALUE_FETCH_METHODS, buildFavoriteDocvalueFetchQuery } from './favorite-docvalue-fetch.mjs';
import { buildFavoritePooledQuery } from './favorite-pooled-utilities.mjs';
import { buildFavoriteMaximaBoundedQuery } from './favorite-maxima-bounded-utilities.mjs';

test('arrival protocol includes scheduled delay and unions errors with slow responses', () => {
  const trials = [{ ordinal: 0, schedulerDelayMs: 800, elapsedMs: 1050 }, { ordinal: 1, schedulerDelayMs: 1, elapsedMs: 1500, error: 'timeout' }, { ordinal: 2, schedulerDelayMs: 20, elapsedMs: 20, error: 'full', clientRejected: true }];
  const result = summarizeOptimizationArrival(trials, []);
  assert.equal(result.strictFailures, 3);
  assert.equal(result.viableAtTestedLoad, false);
  assert.equal(result.clientRejected, 1);
});
test('changing queries cover hue, neutral colors, proportions and combinations supported by the full preset bank', () => {
  const queries = optimizationArrivalQueries('varied');
  assert.ok(queries.length >= 64);
  assert.equal(new Set(queries.map(item => item.id)).size, queries.length);
  assert.ok(queries.some(item => item.query.targets.length === 5));
  for (const item of queries) assert.doesNotThrow(() => buildFavoriteUtilityQuery({ query: item.query, parameters: { ...FAVORITE_PARAMETERS, bucketCount: 256 }, method: 'favorite-utility-rank16', limit: 20 }));
  assert.equal(optimizationArrivalQueries('fixed').length, 4);
  assert.throws(() => optimizationArrivalQueries('unknown'));
});
test('only completed, matching all-four-query C1 profiles permit arrival escalation', () => {
  const candidate = { id: 'test', method: 'favorite-utility-rank16', index: 'color-exploration-test', parameters: { bucketCount: 256 } };
  const queries = optimizationArrivalQueries('fixed');
  const artifact = { finishedAt: '2026-09-23T00:00:00Z', experiment: 'favorite-optimization-benchmark', configuration: { count: 1000000 }, candidates: [candidate],
    profiles: queries.map(item => ({ candidateId: candidate.id, queryId: item.id, selectivity: 'all', concurrency: 1, viableAtTestedLoad: true, trials: Array.from({ length: 32 }, (_, ordinal) => ({ ordinal, elapsedMs: 5 })), minimumRequests: 32, requestedDurationMs: 10000, elapsedMs: 10000 })),
    warmups: queries.map(item => ({ candidateId: candidate.id, caseId: candidate.id + ':' + item.id, count: 1000000, trials: [{ ordinal: 0, elapsedMs: 5 }] })) };
  assert.equal(selectOptimizationArrivalCandidates([candidate], artifact).selected.length, 1);
  const failed = structuredClone(artifact); failed.profiles[0].trials[0].error = 'timeout';
  assert.equal(selectOptimizationArrivalCandidates([candidate], failed).selected.length, 0);
  const changed = { ...candidate, parameters: { bucketCount: 256, qualityInfluence: 1 } };
  assert.throws(() => selectOptimizationArrivalCandidates([changed], artifact), /parameters|identity/);
  assert.throws(() => selectOptimizationArrivalCandidates([candidate], { ...artifact, finishedAt: undefined }), /finished/);
});
test('configuration bounds load and requires separate immutable output', () => {
  const args = ['--config', 'c.json', '--artifact', 'a/benchmark.json', '--directory', 'b'];
  assert.deepEqual(optimizationArrivalConfiguration(args).rates, [8, 32, 64, 128]);
  assert.throws(() => optimizationArrivalConfiguration([...args, '--rates', '32,8']));
  assert.throws(() => optimizationArrivalConfiguration([...args, '--directory', 'a']));
  assert.throws(() => optimizationArrivalConfiguration([...args, '--workload', 'invalid']));
  assert.equal(optimizationArrivalConfiguration(args).workload, 'varied');
  assert.equal(optimizationArrivalConfiguration([...args, '--workload', 'wide']).workload, 'wide');
  assert.equal(optimizationArrivalConfiguration(args).durationMs, 30000);
  for (const seconds of [1, 600]) assert.equal(optimizationArrivalConfiguration([...args, '--duration-seconds', String(seconds)]).durationMs, seconds * 1000);
  for (const seconds of ['0', '601', '1.5', 'NaN']) assert.throws(() => optimizationArrivalConfiguration([...args, '--duration-seconds', seconds]), /duration/i);
});

test('registered doc-value fetch variants validate parent encoding, numeric points and keyword ID doc values', () => {
  const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] }, parameters = { bucketCount: 256 };
  const plan = createFavoriteUtilityPlan({ requests: [{ query, parameters }] });
  for (const descriptor of FAVORITE_DOCVALUE_FETCH_METHODS) {
    const precision = descriptor.parentMethod === 'favorite-utility-rank27', encoding = precision ? 'rank27' : 'numeric';
    const mapping = (precision ? favoritePrecisionMapping(plan, { encodings: [encoding] }) : favoriteUtilityMapping(plan, { encodings: [encoding] })).mappings;
    if (!precision) for (const field of Object.values(mapping.properties.utilities.properties)) field.index = true;
    mapping._meta = { experiment: precision ? 'strict-hue-favorite-precision-utilities' : 'strict-hue-favorite-utilities',
      utilityDefinitionVersion: 2, precisionDefinitionVersion: 1, parentUtilityDefinitionVersion: 2, numericPoints: true,
      mode: 'scale', scope: 'full', count: 1000000, presets: 'favorite', encodings: [encoding], identityHash: 'identity', planHash: 'plan' };
    const candidate = { id: descriptor.id, method: descriptor.id, parameters };
    const body = buildFavoriteDocvalueFetchQuery({ method: descriptor.id, query, parameters });
    const args = { candidate, state: { mapping }, queryPlans: [{ candidateId: candidate.id, queryId: 'sample', body }], workload: 'wide' };
    const validation = validateOptimizationArrivalFields(args);
    assert.equal(validation.encoding, encoding); assert.equal(validation.docvalueIdRequired, true);
    assert.equal(validation.numericPointsRequired, descriptor.parentMethod === 'favorite-utility-sorted');
    for (const id of [{ type: 'keyword', doc_values: false }, { type: 'text' }, undefined]) {
      const changed = structuredClone(mapping); changed.properties.id = id;
      assert.throws(() => validateOptimizationArrivalFields({ ...args, state: { mapping: changed } }), /ID.*doc values/i);
    }
    const withoutPoints = structuredClone(mapping); withoutPoints._meta.numericPoints = false;
    if (descriptor.parentMethod === 'favorite-utility-sorted') assert.throws(() => validateOptimizationArrivalFields({ ...args, state: { mapping: withoutPoints } }), /point/i);
    else assert.doesNotThrow(() => validateOptimizationArrivalFields({ ...args, state: { mapping: withoutPoints } }));
    assert.throws(() => validateOptimizationArrivalFields({ ...args, candidate: { ...candidate, method: descriptor.id + '-unknown' } }), /encoding/i);
  }
});

test('the exact maxima method requires numeric points, ID doc values and its explicit executor', () => {
  const parameters = { bucketCount: 256 }, query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
  const candidate = { id: 'maxima', method: 'favorite-utility-maxima-bounded', parameters,
    builder: { module: './favorite-maxima-bounded-utilities.mjs', export: 'buildFavoriteMaximaBoundedQuery' },
    executor: { module: './favorite-maxima-bounded-utilities.mjs', export: 'executeFavoriteMaximaBoundedUtilitySearch' } };
  const plan = createFavoriteUtilityPlan({ requests: [{ query, parameters }] });
  const mapping = favoriteCompiledMapping(plan, { encodings: ['numeric'], numericPoints: true }).mappings;
  mapping._meta = { experiment: 'strict-hue-favorite-utilities', utilityDefinitionVersion: 2, compiledEncoderVersion: 1,
    mode: 'scale', scope: 'full', count: 1000000, presets: 'favorite', encodings: ['numeric'], numericPoints: true, identityHash: 'identity', planHash: 'plan' };
  const args = { candidate, state: { mapping }, workload: 'wide', queryPlans: compileOptimizationArrivalPlans(candidate, [{ id: 'red', query }], buildFavoriteMaximaBoundedQuery) };
  const result = validateOptimizationArrivalFields(args);
  assert.equal(result.encoding, 'numeric'); assert.equal(result.numericPointsRequired, true); assert.equal(result.docvalueIdRequired, true);
  assert.equal(result.boundDefinition.version, 1);
  for (const patch of [{ executor: undefined }, { executor: { ...candidate.executor, export: 'buildFavoriteMaximaBoundedQuery' } }]) assert.throws(() => validateOptimizationArrivalFields({ ...args, candidate: { ...candidate, ...patch } }), /executor/i);
  for (const mutate of [m => { m._meta.numericPoints = false; }, m => { m.properties.id.doc_values = false; }, m => { Object.values(m.properties.utilities.properties)[0].index = false; }]) {
    const altered = structuredClone(mapping); mutate(altered);
    assert.throws(() => validateOptimizationArrivalFields({ ...args, state: { mapping: altered } }), /point|ID.*doc values/i);
  }
  assert.throws(() => validateOptimizationArrivalFields({ ...args, candidate: { ...candidate, method: 'favorite-utility-maxima-bounded-unknown' } }), /encoding/);
});

test('wide preflight compiles every shuffled query with merged controls and covers every stored favorite utility', () => {
  const queries = optimizationArrivalQueries('wide');
  assert.equal(queries.length, 8184);
  const candidate = { id: 'rank18', method: 'favorite-utility-rank18', parameters: { ...FAVORITE_PARAMETERS, bucketCount: 256 } };
  const plans = compileOptimizationArrivalPlans(candidate, queries, buildFavoritePrecisionQuery);
  const actual = new Set(plans.flatMap(plan => plan.utilityKeys));
  const expected = new Set(createFavoriteUtilityPlan({ presets: [candidate.parameters] }).descriptors.map(item => item.key));
  assert.deepEqual(actual, expected);
  assert.equal(actual.size, 6138);
  assert.ok(plans.every(plan => plan.parameters.qualityInfluence === .5 && plan.parameters.cutoffBlendExponent === 1 && plan.parameters.namedMode === 'named-families'));
  assert.ok(plans.every((plan, i) => plan.queryId === queries[i].id && plan.queryOrdinal === i));
  assert.ok(plans.some(plan => plan.targetCount === 5));
  const primary = compileOptimizationArrivalPlans(candidate, optimizationArrivalQueries('fixed'), buildFavoritePrecisionQuery);
  assert.equal(primary.length, 4);
  assert.ok(primary.every(plan => plan.parameters.namedMode === 'concrete-swatches'));
});

test('request identity, compilation and custom execution share merged item parameters', async () => {
  const candidate = { id: 'rank16', method: 'favorite-utility-rank16', index: 'example', parameters: { bucketCount: 256, qualityInfluence: .5, cutoffBlendExponent: 3 } };
  const item = { id: 'named', parameters: { namedMode: 'named-families' }, query: { mode: 'vibe', targets: [{ name: 'red' }] } };
  const expected = { bucketCount: 256, qualityInfluence: .5, cutoffBlendExponent: 3, namedMode: 'named-families' };
  assert.deepEqual(optimizationArrivalItem(candidate, item).parameters, expected);
  const plans = compileOptimizationArrivalPlans(candidate, [item], buildFavoriteUtilityQuery);
  assert.deepEqual(plans[0].parameters, expected);
  assert.ok(plans[0].utilityKeys.every(key => key.startsWith('n_red_') && key.endsWith('_q050_w3')));
  let compiled, executed;
  await executeOptimizationArrivalRequest({ candidate, item,
    builder: options => { compiled = options.parameters; return buildFavoriteUtilityQuery(options); },
    executor: async options => { executed = options.parameters; return { hits: Array.from({ length: 20 }, (_, i) => ({ id: String(i), score: 1 })), evidence: {} }; } });
  assert.deepEqual(compiled, expected); assert.deepEqual(executed, expected);
  const identity = optimizationArrivalTrialIdentity(candidate, [item], 17);
  assert.equal(identity.queryOffset, 17); assert.equal(identity.queryOrdinal, 0); assert.equal(identity.queryId, item.id);
  assert.deepEqual(identity.parameters, expected);
});

test('wide warms only64 evenly spaced ordinals while existing workloads warm every query', () => {
  const wide = optimizationArrivalWarmupOrdinals('wide', 8184);
  assert.equal(wide.length, 64); assert.equal(new Set(wide).size, 64);
  assert.equal(wide[0], 0); assert.equal(wide.at(-1), 8183);
  const gaps = wide.slice(1).map((value, i) => value - wide[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1);
  assert.deepEqual(optimizationArrivalWarmupOrdinals('fixed', 4), [0, 1, 2, 3]);
  assert.equal(optimizationArrivalWarmupOrdinals('varied', 75).length, 75);
});

test('wide warmup retains every error and continues through all64 selected queries', async () => {
  const candidate = { id: 'bounded', parameters: { qualityInfluence: .5 }, executor: {} }, queries = optimizationArrivalQueries('wide');
  const queryOrdinals = optimizationArrivalWarmupOrdinals('wide', queries.length), calls = [], recorded = [];
  const errors = new Set([queryOrdinals[0], queryOrdinals[31], queryOrdinals.at(-1)]);
  let time = 0;
  const rows = await runOptimizationArrivalWarmups({ candidate, queries, queryOrdinals, now: () => ++time,
    request: async (ordinal, includeEvidence) => {
      calls.push(ordinal); assert.equal(includeEvidence, true);
      if (errors.has(ordinal)) throw Object.assign(Error('failure-' + ordinal), { evidence: { stages: [{ phase: 'failed' }] } });
      return { serviceTookMs: 1, hitCount: 20 };
    }, record: async row => { recorded.push(row); } });
  assert.deepEqual(calls, queryOrdinals); assert.deepEqual(recorded, rows); assert.equal(rows.length, 64);
  assert.deepEqual(rows.filter(row => row.error).map(row => row.queryOrdinal), [...errors]);
  assert.ok(rows.filter(row => row.error).every(row => row.executionEvidence.stages[0].phase === 'failed'));
  assert.ok(rows.every((row, i) => row.ordinal === i && row.queryId === queries[queryOrdinals[i]].id && row.parameters.namedMode === 'named-families' && row.parameters.qualityInfluence === .5));
});

test('arrival coverage records advancing offsets and successful keys without counting rejected or failed requests', () => {
  const candidate = { id: 'numeric', method: 'favorite-utility-numeric', parameters: { bucketCount: 256 } };
  const queries = optimizationArrivalQueries('fixed'), plans = compileOptimizationArrivalPlans(candidate, queries, buildFavoriteUtilityQuery);
  const rows = [
    { ordinal: 0, elapsedMs: 10, ...optimizationArrivalTrialIdentity(candidate, queries, 3) },
    { ordinal: 1, elapsedMs: 1500, error: 'timeout', ...optimizationArrivalTrialIdentity(candidate, queries, 4) },
    { ordinal: 2, elapsedMs: 20, error: 'full', clientRejected: true, ...optimizationArrivalTrialIdentity(candidate, queries, 5) },
  ];
  const expected = [...new Set(plans.flatMap(plan => plan.utilityKeys))];
  const coverage = summarizeOptimizationArrivalCoverage({ trials: rows, queryPlans: plans, expectedUtilityKeys: expected });
  assert.equal(coverage.firstQueryOffset, 3); assert.equal(coverage.nextQueryOffset, 6);
  assert.equal(coverage.scheduled.distinctQueryCount, 3); assert.equal(coverage.dispatched.distinctQueryCount, 2);
  assert.equal(coverage.successful.distinctQueryCount, 1);
  assert.equal(coverage.successful.utilityKeyCount, plans[3].utilityKeys.length);
  assert.equal(coverage.successful.fullUtilityBankCovered, false);
  assert.equal(coverage.successful.targetCounts['5'], 1);
  assert.match(coverage.latencyLabel, /mixed/i);
  const more = [0, 1, 2, 3].map((ordinal) => ({ ordinal, elapsedMs: 10, ...optimizationArrivalTrialIdentity(candidate, queries, 6 + ordinal) }));
  const cumulative = summarizeOptimizationArrivalCoverage({ trials: [...rows, ...more], queryPlans: plans, expectedUtilityKeys: expected });
  assert.equal(cumulative.successful.fullUtilityBankCovered, true);
  assert.equal(cumulative.nextQueryOffset, 10);
  assert.throws(() => summarizeOptimizationArrivalCoverage({ trials: [{ ...rows[0], queryId: 'not-in-preflight' }], queryPlans: plans, expectedUtilityKeys: expected }), /preflight/i);
});

test('primary approval is bound to unchanged recursive builder sources and fixed query plans', () => {
  const candidate = { id: 'rank16', method: 'favorite-utility-rank16', index: 'color-exploration-test', parameters: { bucketCount: 256 } };
  const builderSources = { 'exploration/builder.mjs': 'builder version 1', 'shared.mjs': 'shared version 1' };
  const queryPlans = optimizationArrivalQueries('fixed').map(item => ({ candidateId: candidate.id, queryId: item.id,
    body: compileFavoriteOptimizationQuery({ ...candidate, ...item }, buildFavoriteUtilityQuery) }));
  const artifact = { sourceHashes: Object.fromEntries(Object.entries(builderSources).map(([key, value]) => [key, hash(value)])),
    queryPlans: queryPlans.map(plan => ({ caseId: candidate.id + ':' + plan.queryId, candidateId: candidate.id, index: candidate.index, body: plan.body, bodyHash: hash(plan.body) })) };
  assert.doesNotThrow(() => validateOptimizationArrivalPrimary({ candidate, artifact, builderSources, queryPlans }));
  assert.throws(() => validateOptimizationArrivalPrimary({ candidate, artifact, builderSources: { ...builderSources, 'shared.mjs': 'changed' }, queryPlans }), /source/i);
  const missingSource = structuredClone(artifact); delete missingSource.sourceHashes['shared.mjs'];
  assert.throws(() => validateOptimizationArrivalPrimary({ candidate, artifact: missingSource, builderSources, queryPlans }), /source/i);
  const changedPlan = structuredClone(queryPlans); changedPlan[0].body.query = { match_all: {} };
  assert.throws(() => validateOptimizationArrivalPrimary({ candidate, artifact, builderSources, queryPlans: changedPlan }), /query/i);
  const corruptPlan = structuredClone(artifact); corruptPlan.queryPlans[0].bodyHash = 'invalid';
  assert.throws(() => validateOptimizationArrivalPrimary({ candidate, artifact: corruptPlan, builderSources, queryPlans }), /query/i);
  assert.throws(() => validateOptimizationArrivalPrimary({ candidate, artifact: { ...artifact, queryPlans: artifact.queryPlans.slice(1) }, builderSources, queryPlans }), /query/i);
});

test('arrival validates stored utility encoding, preset, definition and every scoring field before queries', () => {
  const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 40 }] };
  const parameters = { bucketCount: 256 }, plan = createFavoriteUtilityPlan({ requests: [{ query, parameters }] });
  const metadata = { experiment: 'strict-hue-favorite-utilities', utilityDefinitionVersion: 2, mode: 'scale', scope: 'full',
    count: 1000000, presets: 'favorite', encodings: ['numeric', 'rank16'], identityHash: 'identity', planHash: 'plan' };
  for (const encoding of ['numeric', 'rank16', 'rank18', 'rank27']) {
    const precision = ['rank18', 'rank27'].includes(encoding), candidate = { id: encoding, method: 'favorite-utility-' + encoding, parameters };
    const mapping = (precision ? favoritePrecisionMapping(plan, { encodings: [encoding] }) : favoriteUtilityMapping(plan, { encodings: [encoding] })).mappings;
    mapping._meta = { ...metadata, encodings: [encoding], ...(precision ? { experiment: 'strict-hue-favorite-precision-utilities', precisionDefinitionVersion: 1, parentUtilityDefinitionVersion: 2 } : {}) };
    const body = (precision ? buildFavoritePrecisionQuery : buildFavoriteUtilityQuery)({ method: candidate.method, query, parameters, limit: 20 });
    const args = { candidate, state: { mapping }, queryPlans: [{ candidateId: candidate.id, queryId: 'sample', body }], workload: 'varied' };
    assert.doesNotThrow(() => validateOptimizationArrivalFields(args));
    for (const changed of [
      { ...mapping._meta, encodings: [] }, { ...mapping._meta, presets: 'unknown' },
      { ...mapping._meta, [precision ? 'precisionDefinitionVersion' : 'utilityDefinitionVersion']: 99 },
      { ...mapping._meta, mode: 'real' }, { ...mapping._meta, scope: 'projection' },
    ]) assert.throws(() => validateOptimizationArrivalFields({ ...args, state: { mapping: { ...mapping, _meta: changed } } }));
    assert.throws(() => validateOptimizationArrivalFields({ ...args, candidate: { ...candidate, parameters: { ...parameters, qualityInfluence: 1 } } }), /preset/i);
    const absent = structuredClone(mapping);
    const field = Object.keys(absent.properties).find(key => key === 'utilities' || key.startsWith('utility_'));
    delete absent.properties[field];
    assert.throws(() => validateOptimizationArrivalFields({ ...args, state: { mapping: absent } }), /field/i);
    if (!precision && encoding === 'numeric') {
      const childMissing = structuredClone(mapping); delete childMissing.properties.utilities.properties[Object.keys(childMissing.properties.utilities.properties)[0]];
      assert.throws(() => validateOptimizationArrivalFields({ ...args, state: { mapping: childMissing } }), /field/i);
    }
  }
});

test('wide validates each query preset and actual encoding before load, not only candidate defaults', () => {
  const candidate = { id: 'rank18', method: 'favorite-utility-rank18', parameters: { bucketCount: 256 } };
  const query = { mode: 'vibe', targets: [{ name: 'red' }] };
  const requests = [{ query, parameters: { namedMode: 'named-families' } }, { query, parameters: { namedMode: 'named-families', qualityInfluence: 1 } }];
  const plan = createFavoriteUtilityPlan({ requests });
  const mapping = favoritePrecisionMapping(plan, { encodings: ['rank18', 'rank27'] }).mappings;
  mapping._meta = { experiment: 'strict-hue-favorite-precision-utilities', precisionDefinitionVersion: 1, parentUtilityDefinitionVersion: 2,
    mode: 'scale', scope: 'full', count: 1000000, presets: 'favorite', encodings: ['rank18', 'rank27'], identityHash: 'identity', planHash: 'plan' };
  const queryPlans = compileOptimizationArrivalPlans(candidate, requests.map((item, i) => ({ ...item, id: String(i) })), buildFavoritePrecisionQuery);
  const args = { candidate, state: { mapping }, queryPlans, workload: 'wide' };
  assert.throws(() => validateOptimizationArrivalFields(args), /preset/i);
  mapping._meta.presets = 'all';
  assert.doesNotThrow(() => validateOptimizationArrivalFields(args));
  mapping._meta.scope = 'projection';
  assert.throws(() => validateOptimizationArrivalFields(args), /full-schema/i);
  mapping._meta.scope = 'full';
  const wrongBody = buildFavoritePrecisionQuery({ method: 'favorite-utility-rank27', query, parameters: requests[0].parameters });
  assert.throws(() => validateOptimizationArrivalFields({ ...args, queryPlans: [{ ...queryPlans[0], body: wrongBody }] }), /encoding/i);
  const invalidControl = { ...queryPlans[0], parameters: { ...queryPlans[0].parameters, qualityInfluence: .123 } };
  assert.throws(() => validateOptimizationArrivalFields({ ...args, queryPlans: [invalidControl] }), /preset/i);
});

test('native full banks use nested scope and require mapped score fields', () => {
  const candidate = { id: 'typed', method: 'favorite-typed-script', parameters: { bucketCount: 256 } };
  const mapping = { _meta: { identity: { scope: 'full' } }, properties: { cov_red: { type: 'integer' }, quality_red: { type: 'float' } } };
  const body = { query: { bool: { filter: [{ exists: { field: 'cov_red' } }, { exists: { field: 'quality_red' } }] } } };
  const args = { candidate, state: { mapping }, queryPlans: [{ candidateId: candidate.id, body }], workload: 'varied' };
  assert.doesNotThrow(() => validateOptimizationArrivalFields(args));
  delete mapping.properties.quality_red;
  assert.throws(() => validateOptimizationArrivalFields(args), /field/i);
});

test('executor loading and primary source binding include its complete recursive graph', async () => {
  const candidate = { id: 'bounded', method: 'favorite-utility-bounded', index: 'color-exploration-test', parameters: { bucketCount: 256 },
    builder: { module: './builder.mjs', export: 'build' }, executor: { module: './executor.mjs', export: 'execute' } };
  const build = options => buildFavoriteUtilityQuery({ ...options, method: 'favorite-utility-numeric' });
  const execute = async () => ({});
  const snapshots = { 'builder.mjs': { 'builder.mjs': 'build', 'shared.mjs': 'shared' }, 'executor.mjs': { 'executor.mjs': 'execute', 'shared.mjs': 'shared', 'pit.mjs': 'pit' } };
  const loaded = await loadOptimizationArrivalModules([candidate], {
    load: async url => url.pathname.endsWith('builder.mjs') ? { build } : { execute },
    snapshot: async url => snapshots[url.pathname.split('/').at(-1)],
  });
  assert.equal(loaded.builders.get(candidate.id), build);
  assert.equal(loaded.executors.get(candidate.id), execute);
  assert.equal(loaded.sources['pit.mjs'], 'pit');
  const queryPlans = optimizationArrivalQueries('fixed').map(item => ({ candidateId: candidate.id, queryId: item.id,
    body: compileFavoriteOptimizationQuery({ ...candidate, ...item }, build) }));
  const artifact = { sourceHashes: Object.fromEntries(Object.entries(loaded.sources).map(([name, source]) => [name, hash(source)])),
    queryPlans: queryPlans.map(plan => ({ ...plan, caseId: candidate.id + ':' + plan.queryId, index: candidate.index, bodyHash: hash(plan.body), executor: candidate.executor })) };
  const args = { candidate, artifact, queryPlans, builderSources: loaded.builderSnapshots.get(candidate.id), executorSources: loaded.executorSnapshots.get(candidate.id) };
  assert.doesNotThrow(() => validateOptimizationArrivalPrimary(args));
  assert.throws(() => validateOptimizationArrivalPrimary({ ...args, executorSources: {} }), /executor/i);
  assert.throws(() => validateOptimizationArrivalPrimary({ ...args, executorSources: { ...args.executorSources, 'pit.mjs': 'changed' } }), /source/i);
  const corrupt = structuredClone(artifact); delete corrupt.queryPlans[0].executor;
  assert.throws(() => validateOptimizationArrivalPrimary({ ...args, artifact: corrupt }), /executor/i);
});

test('arrival executes the custom service path and preserves warmup stage evidence and timeout', async () => {
  const candidate = { id: 'bounded', method: 'favorite-utility-bounded', index: 'color-exploration-test', parameters: { bucketCount: 256 }, executor: { module: './executor.mjs', export: 'execute' } };
  const item = optimizationArrivalQueries('fixed')[0];
  let request;
  const response = { hits: Array.from({ length: 20 }, (_, i) => ({ id: 'id-' + i, score: 1 - i / 20 })),
    evidence: { serviceTookMs: 5, stages: [{ phase: 'global-final' }], globalBounds: { threshold: .4 } } };
  const builder = options => buildFavoriteUtilityQuery({ ...options, method: 'favorite-utility-numeric' });
  const executor = async options => { request = options; return response; };
  const result = await executeOptimizationArrivalRequest({ candidate, item, builder, executor, includeExecutionEvidence: true,
    search: async () => { throw Error('Must not execute the metadata-only reference body.'); } });
  assert.equal(request.timeoutMs, 1500); assert.equal(request.serviceTimeout, '950ms');
  assert.equal(request.index, candidate.index); assert.deepEqual(request.query, item.query);
  assert.deepEqual(result.executionEvidence, response.evidence);
  assert.equal(result.hitsHash, hash(response.hits));
  assert.equal((await executeOptimizationArrivalRequest({ candidate, item, builder, executor })).executionEvidence, undefined);
});

test('mixed compiled indexes retain encoding validation and sorted/bounded methods require numeric points', () => {
  const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] }, parameters = { bucketCount: 256 };
  const plan = createFavoriteUtilityPlan({ requests: [{ query, parameters }] });
  const mapping = favoriteCompiledMapping(plan, { encodings: ['numeric', 'rank18'], numericPoints: true }).mappings;
  mapping._meta = { experiment: 'strict-hue-favorite-compiled-utilities', compiledEncoderVersion: 1, utilityDefinitionVersion: 2,
    precisionDefinitionVersion: 1, parentUtilityDefinitionVersion: 2, mode: 'scale', scope: 'full', count: 1000000,
    presets: 'favorite', encodings: ['numeric', 'rank18'], numericPoints: true, identityHash: 'identity', planHash: 'plan' };
  for (const method of ['favorite-utility-numeric', 'favorite-utility-rank18', 'favorite-utility-sorted', 'favorite-utility-sorted-scored', 'favorite-utility-bounded']) {
    const candidate = { id: method, method, parameters };
    const body = method.endsWith('rank18') ? buildFavoritePrecisionQuery({ method, query, parameters }) : buildFavoriteUtilityQuery({ method: 'favorite-utility-numeric', query, parameters });
    const args = { candidate, state: { mapping }, queryPlans: [{ candidateId: candidate.id, body }], workload: 'varied' };
    const result = validateOptimizationArrivalFields(args);
    assert.equal(result.encoding, method.endsWith('rank18') ? 'rank18' : 'numeric');
    const wrongVersion = structuredClone(mapping); wrongVersion._meta.compiledEncoderVersion = 99;
    assert.throws(() => validateOptimizationArrivalFields({ ...args, state: { mapping: wrongVersion } }), /definition|encoding/);
    const absent = structuredClone(mapping); absent._meta.encodings = [];
    assert.throws(() => validateOptimizationArrivalFields({ ...args, state: { mapping: absent } }), /definition|encoding/);
    if (['favorite-utility-sorted', 'favorite-utility-sorted-scored', 'favorite-utility-bounded'].includes(method)) {
      const noPoints = structuredClone(mapping); noPoints._meta.numericPoints = false;
      assert.throws(() => validateOptimizationArrivalFields({ ...args, state: { mapping: noPoints } }), /point/i);
      const unindexed = structuredClone(mapping); Object.values(unindexed.properties.utilities.properties)[0].index = false;
      assert.throws(() => validateOptimizationArrivalFields({ ...args, state: { mapping: unindexed } }), /point/i);
    }
  }
});
test('both exact pooled methods requires numeric points, ID doc values and its explicit executor', () => {
  for (const method of ['favorite-utility-bounded-pooled-delete', 'favorite-utility-maxima-bounded-pooled-delete']) {
  const parameters = { bucketCount: 256 }, query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
  const candidate = { id: 'maxima', method, parameters,
    builder: { module: './favorite-pooled-utilities.mjs', export: 'buildFavoritePooledQuery' },
    executor: { module: './favorite-pooled-utilities.mjs', export: 'executeFavoritePooledUtilitySearch' } };
  const plan = createFavoriteUtilityPlan({ requests: [{ query, parameters }] });
  const mapping = favoriteCompiledMapping(plan, { encodings: ['numeric'], numericPoints: true }).mappings;
  mapping._meta = { experiment: 'strict-hue-favorite-utilities', utilityDefinitionVersion: 2, compiledEncoderVersion: 1,
    mode: 'scale', scope: 'full', count: 1000000, presets: 'favorite', encodings: ['numeric'], numericPoints: true, identityHash: 'identity', planHash: 'plan' };
  const args = { candidate, state: { mapping }, workload: 'wide', queryPlans: compileOptimizationArrivalPlans(candidate, [{ id: 'red', query }], buildFavoritePooledQuery) };
  const result = validateOptimizationArrivalFields(args);
  assert.equal(result.encoding, 'numeric'); assert.equal(result.numericPointsRequired, true); assert.equal(result.docvalueIdRequired, true);
  assert.equal(result.transportDefinition.version, 1);
  assert.equal(result.transportDefinition.transport.retries, 0);
  for (const patch of [{ executor: undefined }, { executor: { ...candidate.executor, export: 'buildFavoritePooledQuery' } }]) assert.throws(() => validateOptimizationArrivalFields({ ...args, candidate: { ...candidate, ...patch } }), /executor/i);
  for (const mutate of [m => { m._meta.numericPoints = false; }, m => { m.properties.id.doc_values = false; }, m => { Object.values(m.properties.utilities.properties)[0].index = false; }]) {
    const altered = structuredClone(mapping); mutate(altered);
    assert.throws(() => validateOptimizationArrivalFields({ ...args, state: { mapping: altered } }), /point|ID.*doc values/i);
  }
  assert.throws(() => validateOptimizationArrivalFields({ ...args, candidate: { ...candidate, method: method + '-unknown' } }), /encoding/);
  }
});

test('arrival request failures retain causes and stages through the scheduler boundary', async () => {
  const { observeOptimizationArrivalRequest } = await import('./favorite-optimization-arrival.mjs');
  const { runArrivals } = await import('./arrival-scheduler.mjs');
  const error = new TypeError('fetch failed', { cause: Object.assign(Error('reset'), { code: 'ECONNRESET' }) });
  error.evidence = { stages: [{ phase: 'pit-close', error: 'fetch failed' }], transport: { attempts: 1 } };
  const result = await runArrivals({ rate: 1000, durationMs: 1, run: () => observeOptimizationArrivalRequest(async () => { throw error; }) });
  assert.equal(result.errors, 1); assert.equal(result.viableAtTestedLoad, false);
  const row = result.trials[0];
  assert.equal(row.errorDetails.cause.code, 'ECONNRESET'); assert.deepEqual(row.executionEvidence, error.evidence);
  assert.ok(Number.isFinite(Date.parse(row.startedAt))); assert.ok(Number.isFinite(Date.parse(row.completedAt)));
});

test('arrival writes all completed rate trials before final stats and persists an unqualified profile on failure', async () => {
  const { finalizeOptimizationArrivalProfile } = await import('./favorite-optimization-arrival.mjs');
  const trials = [{ ordinal: 0, elapsedMs: 1, schedulerDelayMs: 0 }], order = [], before = { nodes: {} };
  const error = new TypeError('fetch failed', { cause: Object.assign(Error('reset'), { code: 'ECONNRESET' }) });
  let saved;
  await assert.rejects(finalizeOptimizationArrivalProfile({ measurement: { durationMs: 1000, elapsedMs: 1000 }, trials,
    warmups: [{ elapsedMs: 1 }], identity: { candidateId: 'x', rate: 1 }, before, samples: [before],
    recordTrials: async rows => { assert.equal(rows, trials); order.push('raw'); },
    readResources: async () => { order.push('stats'); throw error; }, persist: async profile => { order.push('profile'); saved = structuredClone(profile); } }), value => value === error);
  assert.deepEqual(order, ['raw', 'stats', 'profile']); assert.deepEqual(saved.trials, trials);
  assert.equal(saved.measurementComplete, true); assert.equal(saved.finalResourceCollectionComplete, false);
  assert.equal(saved.viableAtTestedLoad, false); assert.equal(saved.after, null); assert.equal(saved.cpuMs, null); assert.equal(saved.clientCpuMs, null);
  assert.equal(saved.resourceCollectionError.errorDetails.cause.code, 'ECONNRESET'); assert.equal(saved.resourceErrors, 1);
  assert.equal(saved.errors, 0); assert.equal(saved.strictFailures, 0);
});
