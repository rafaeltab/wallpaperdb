import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITE_PARAMETERS } from './favorite-scale-corpus.mjs';
import { buildCutoffQuery } from './methods-cutoff.mjs';
import {
  favoriteOptimizationConfiguration, validateFavoriteOptimizationCandidates,
  favoriteOptimizationCases, compileFavoriteOptimizationQuery,
  remainingFavoriteOptimizationConcurrencies, validateFavoriteOptimizationIndex,
  favoriteOptimizationFeedbackConfig, summarizeFavoriteOptimizationProfile,
  summarizeFavoriteOptimizationInstrumentation, favoriteOptimizationResourcePeaks,
  executeFavoriteOptimizationRequest,
} from './favorite-optimization-benchmark.mjs';

const candidate = () => ({ id: 'baseline256', method: 'cutoff-shade-hue-all-levels',
  index: 'color-exploration-favorite-projection-scale-v1', realIndex: 'color-exploration-shade-hue-256-real-v1',
  parameters: { ...FAVORITE_PARAMETERS, bucketCount: 256 }, builder: { module: './methods-cutoff.mjs', export: 'buildCutoffQuery' } });
const config = (...args) => favoriteOptimizationConfiguration(['--config', '/tmp/candidates.json', '--count', '100000', '--directory', '/tmp/new-campaign', ...args]);

test('benchmark defaults preserve full workload, fixed duration and ascending gated concurrency', () => {
  const value = config();
  assert.deepEqual(value.concurrencies, [1, 4, 16]);
  assert.deepEqual(value.selectivities, ['all', 'partition10', 'tag1']);
  assert.equal(value.requests, 32); assert.equal(value.durationMs, 10000);
  assert.deepEqual(config('--concurrency', '1', '--selectivity', 'all').concurrencies, [1]);
  for (const args of [['--concurrency', '4'], ['--concurrency', '1,16,4'], ['--selectivity', 'all,unknown'], ['--selectivity', 'all,all'], ['--count', '99999'], ['--duration', '1']]) assert.throws(() => config(...args));
});
test('service executors retain metadata and strict budgets without falling back to application ranking', async () => {
  const item = { ...candidate(), query: { mode: 'vibe', targets: [{ color: '#ff0000' }] }, filter: { tags: ['city'] } };
  const expected = { hits: [{ id: 'server-first', score: .2 }], evidence: { serviceTookMs: 2 } };
  let received;
  const result = await executeFavoriteOptimizationRequest(item, buildCutoffQuery, async options => { received = options; return expected; }, () => { throw Error('Unexpected ordinary search'); });
  assert.equal(result, expected);
  assert.deepEqual(received.filter, item.filter);
  assert.equal(received.timeoutMs, 1500); assert.equal(received.serviceTimeout, '950ms'); assert.equal(received.limit, 20);
  assert.equal(received.index, item.index); assert.equal(received.method, item.method);
  assert.throws(() => validateFavoriteOptimizationCandidates({ schemaVersion: 1, candidates: [{ ...candidate(), executor: { module: '../escape.mjs', export: 'run' } }] }), /executor/);
});

test('explicit builders admit unregistered methods while rejecting ambiguous or invalid candidates', () => {
  const newMethod = { ...candidate(), method: 'not-yet-registered' };
  assert.equal(validateFavoriteOptimizationCandidates({ schemaVersion: 1, candidates: [newMethod] }).length, 1);
  for (const candidates of [[candidate(), candidate()], [{ ...candidate(), parameters: { bucketCount: 1024 } }], [{ ...candidate(), index: 'production-index' }], [{ ...candidate(), builder: { module: '../escape.mjs', export: 'build' } }]]) {
    assert.throws(() => validateFavoriteOptimizationCandidates({ schemaVersion: 1, candidates }));
  }
});

test('all12 workload cases compile exact baseline bodies without profiling in timed requests', () => {
  const candidates = [candidate()], cases = favoriteOptimizationCases(candidates, config());
  assert.equal(cases.length, 12);
  assert.equal(favoriteOptimizationCases(candidates, config('--selectivity', 'all')).length, 4);
  for (const item of cases) {
    const body = compileFavoriteOptimizationQuery(item, buildCutoffQuery);
    const expected = buildCutoffQuery({ method: item.method, parameters: item.parameters, query: item.query, filter: item.filter, limit: 20 });
    assert.deepEqual(body, { ...expected, timeout: '950ms' });
    assert.ok(!body.profile);
  }
  assert.throws(() => compileFavoriteOptimizationQuery(cases[0], () => ({ size: 100, query: { match_all: {} } })), /top20/);
  assert.throws(() => compileFavoriteOptimizationQuery(cases[0], () => ({ size: 20, profile: true, query: { match_all: {} } })), /profil/i);
});

test('profiling preserves nested raw counters without treating repeated parent and child scores as distinct documents', () => {
  const profile = { shards: [{ id: 'shard0', searches: [{ query: [{ type: 'BooleanQuery', description: 'parent', time_in_nanos: 200,
    breakdown: { score_count: 12, advance_count: 99, score: 100 }, children: [{ type: 'FeatureQuery', description: 'child', time_in_nanos: 100,
      breakdown: { score_count: 12, next_doc_count: 14 } }] }], collector: [{ name: 'TopScoreDocCollector', reason: 'search_top_hits', time_in_nanos: 50 }] }] }] };
  const result = summarizeFavoriteOptimizationInstrumentation(profile);
  assert.equal(result.queryNodes.length, 2);
  assert.equal(result.queryNodes[0].counts.score_count, 12);
  assert.equal(result.queryNodes[1].counts.score_count, 12);
  assert.equal(result.queryNodes[0].counts.advance_count, 99);
  assert.ok(!('totalScoredDocuments' in result));
  assert.equal(result.collectors[0].name, 'TopScoreDocCollector');
  assert.deepEqual(summarizeFavoriteOptimizationInstrumentation(undefined).queryNodes, []);
});

test('failed resource samples cannot poison observed finite peaks', () => {
  const peaks = favoriteOptimizationResourcePeaks([{ error: 'stats unavailable' }, { nodes: { node: { jvm: { mem: { heap_used_in_bytes: 42 } } } }, clientMemory: { rss: 70 } },
    { nodes: { node: { jvm: { mem: { heap_used_in_bytes: NaN } } } }, clientMemory: { rss: NaN } }]);
  assert.deepEqual(peaks, { peakObservedHeapBytes: 42, peakObservedClientRssBytes: 70 });
  assert.deepEqual(favoriteOptimizationResourcePeaks([{ error: 'none' }]), { peakObservedHeapBytes: null, peakObservedClientRssBytes: null });
});

test('warmup and union failures gate higher loads while retaining a C1 diagnostic', () => {
  const requested = [1, 4, 16];
  assert.deepEqual(remainingFavoriteOptimizationConcurrencies(requested, [{ elapsedMs: 1000 }], []), [1]);
  assert.deepEqual(remainingFavoriteOptimizationConcurrencies(requested, [{ elapsedMs: 1 }], [{ concurrency: 1, viableAtTestedLoad: true }]), [4, 16]);
  assert.deepEqual(remainingFavoriteOptimizationConcurrencies(requested, [{ elapsedMs: 1 }], [{ concurrency: 1, viableAtTestedLoad: false }]), []);
  const measured = { elapsedMs: 10000, trials: [
    { ordinal: 0, elapsedMs: 1 }, { ordinal: 1, elapsedMs: 1001, error: 'slow failure' }, { ordinal: 2, elapsedMs: 5, error: 'fast failure' },
  ] };
  const summary = summarizeFavoriteOptimizationProfile(measured, [{ elapsedMs: 1000, error: 'warmup' }]);
  assert.equal(summary.strictTimedFailures, 2);
  assert.equal(summary.strictWarmupFailures, 1);
  assert.equal(summary.strictFailures, 3);
  assert.equal(summary.viableAtTestedLoad, false);
});

test('count validation rejects a smaller index and drift rather than relabeling measurements', () => {
  const state = { count: 100000, uuid: 'uuid', mappingHash: 'mapping', metadataHash: 'metadata', indexing: { index_total: 100000, delete_total: 0 } };
  assert.equal(validateFavoriteOptimizationIndex(state, 100000), true);
  assert.throws(() => validateFavoriteOptimizationIndex(state, 1000000), /count/);
  assert.throws(() => validateFavoriteOptimizationIndex({ ...state, uuid: 'new' }, 100000, state), /changed/);
  assert.throws(() => validateFavoriteOptimizationIndex({ ...state, indexing: { index_total: 100001, delete_total: 0 } }, 100000, state), /changed/);
});

test('feedback config uses explicit real indexes and keeps pagoda development case provenance', () => {
  const feedback = favoriteOptimizationFeedbackConfig([candidate()]);
  assert.equal(feedback.candidates[0].index, candidate().realIndex);
  assert.equal(feedback.candidates[0].module, './adapter.mjs');
  assert.deepEqual(feedback.candidates[0].parameters, candidate().parameters);
  assert.equal(feedback.workload.accuracyLimit, 1000);
  assert.deepEqual(feedback.extraImageFiles, ['evaluation/perceived-red-pagoda-001.json']);
  assert.throws(() => favoriteOptimizationFeedbackConfig([{ ...candidate(), realIndex: undefined }]), /realIndex/);
});

test('failed trials retain nested transport causes, executor stages and wall times without changing latency', async () => {
  const { observeFavoriteOptimizationTrial } = await import('./favorite-optimization-benchmark.mjs');
  const cause = Object.assign(Error('reset'), { code: 'ECONNRESET', syscall: 'read' });
  cause.cause = cause;
  const error = new TypeError('fetch failed', { cause });
  error.evidence = { stages: [{ phase: 'pit-close', error: 'fetch failed' }], transport: { attempts: 1 } };
  const ticks = [10, 15], dates = ['2026-09-23T00:00:00Z', '2026-09-23T00:00:00.005Z'];
  const result = await observeFavoriteOptimizationTrial({ request: async () => { throw error; }, expectedHits: 20,
    now: () => ticks.shift(), wallTime: () => dates.shift() });
  assert.equal(result.elapsedMs, 5); assert.equal(result.error, 'fetch failed'); assert.equal(result.hitCount, 0);
  assert.equal(result.errorDetails.cause.code, 'ECONNRESET'); assert.equal(result.errorDetails.cause.syscall, 'read');
  assert.match(JSON.stringify(result.errorDetails.cause.cause), /circular/i);
  assert.deepEqual(result.executionEvidence, error.evidence);
  assert.equal(result.startedAt, '2026-09-23T00:00:00Z'); assert.equal(result.completedAt, '2026-09-23T00:00:00.005Z');
  const success = await observeFavoriteOptimizationTrial({ request: async () => ({ hits: [{ id: 'a', score: 1 }], evidence: { serviceTookMs: 1 } }), expectedHits: 1 });
  assert.equal(success.hitCount, 1); assert.equal(success.hits, undefined); assert.equal(success.executionEvidence, undefined);
});

test('final resource failure persists completed measurements before rethrow and prevents qualification', async () => {
  const { finalizeFavoriteOptimizationProfile } = await import('./favorite-optimization-benchmark.mjs');
  const measurement = { elapsedMs: 10001, trials: [{ ordinal: 0, elapsedMs: 2 }] }, warmups = [{ elapsedMs: 1 }];
  const before = { nodes: { n: { process: { cpu: { total_in_millis: 5 } } } }, clientCpu: { user: 3, system: 2 } };
  const error = new TypeError('fetch failed', { cause: Object.assign(Error('reset'), { code: 'ECONNRESET' }) });
  let saved;
  await assert.rejects(finalizeFavoriteOptimizationProfile({ identity: { id: 'profile' }, measurement, warmups, before, samples: [before],
    readResources: async () => { throw error; }, persist: async profile => { saved = structuredClone(profile); } }), value => value === error);
  assert.equal(saved.id, 'profile'); assert.deepEqual(saved.trials, measurement.trials); assert.equal(saved.p95Ms, 2);
  assert.equal(saved.measurementComplete, true); assert.equal(saved.finalResourceCollectionComplete, false);
  assert.equal(saved.timedRequestsViable, true); assert.equal(saved.viableAtTestedLoad, false);
  assert.equal(saved.after, null); assert.equal(saved.cpuMs, null); assert.equal(saved.clientCpuMs, null);
  assert.equal(saved.resourceErrors, 1); assert.equal(saved.resourceCollectionError.errorDetails.cause.code, 'ECONNRESET');
  const after = { nodes: { n: { process: { cpu: { total_in_millis: 10 } } } }, clientCpu: { user: 13, system: 12 } };
  const normal = await finalizeFavoriteOptimizationProfile({ identity: { id: 'good' }, measurement, warmups, before, samples: [before],
    readResources: async () => after, persist: async () => {} });
  assert.equal(normal.finalResourceCollectionComplete, true); assert.equal(normal.viableAtTestedLoad, true);
  assert.equal(normal.cpuMs, 5); assert.equal(normal.clientCpuMs, .02);
});
