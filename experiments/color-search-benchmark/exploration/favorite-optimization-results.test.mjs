import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { summarizeOptimizationPerformance, summarizeOptimizationFidelity, summarizeOptimizationFeedback, optimizationIndexSummary, optimizationResultsConfiguration, generateOptimizationResults } from './favorite-optimization-results.mjs';

test('performance summary keeps scope and strict failure unions, never inventing missing concurrency', () => {
  const result = { experiment: 'favorite-optimization-benchmark', finishedAt: '2026-09-23T00:00:00Z', configuration: { count: 1000000 },
    indexBefore: [{ index: 'projection', count: 1000000, mapping: { _source: { enabled: false }, _meta: { scope: 'projection' } } },
      { index: 'full', count: 1000000, mapping: { _meta: { scope: 'full' } } }],
    profiles: [{ candidateId: 'numeric', method: 'numeric', index: 'projection', concurrency: 1, elapsedMs: 10000, p95Ms: 5, viableAtTestedLoad: false,
      trials: [{ elapsedMs: 5 }, { elapsedMs: 1200, error: 'timeout' }], cpuMs: 4000, clientCpuMs: 100 }],
    warmups: [{ trials: [{ elapsedMs: 1000 }] }] };
  const summary = summarizeOptimizationPerformance(result, 'file');
  assert.equal(summary.complete, true); assert.equal(summary.profiles[0].scope, 'projection');
  assert.equal(summary.indexes[1].scope, 'full'); assert.equal(summary.profiles.length, 1);
  assert.deepEqual(summary.timed, { requests: 2, errors: 1, atOrAboveOneSecond: 1, strictFailures: 1 });
  assert.equal(summary.warmup.strictFailures, 1); assert.equal(summary.profiles[0].resources.meanServerCpuCores, .4);
  assert.equal(summary.profiles[0].resources.peakSampledHeapBytes, null);
  assert.equal(summarizeOptimizationPerformance({ ...result, finishedAt: undefined }, 'partial').pendingProfilesAreNotPasses, true);
});

test('arrival records scheduled latency without relabeling it successful-only p95', () => {
  const result = { experiment: 'favorite-optimization-arrival', configuration: { workload: 'varied' }, selection: { selected: [{ id: 'bounded', method: 'favorite-utility-bounded', index: 'full' }] },
    profiles: [{ candidateId: 'bounded', rate: 64, p95Ms: 900, trials: [{ elapsedMs: 1200, error: 'timeout' }] }], warmups: [{ elapsedMs: 5 }] };
  const row = summarizeOptimizationPerformance(result, 'arrival').profiles[0];
  assert.equal(row.p95EndToEndMs, 900); assert.equal(row.p95SuccessfulMs, null);
  assert.equal(row.arrivalRate, 64); assert.equal(row.concurrency, null); assert.equal(row.method, 'favorite-utility-bounded');
});

test('fidelity and feedback retain numerical changes and incomplete human-case coverage', () => {
  const fidelity = summarizeOptimizationFidelity({ finishedAt: 'time', passed: true, rows: [
    { method: 'numeric', count: 545, identicalIds: true, identicalScores: false, maximumScoreError: 1e-7, top20Overlap: 20 },
    { method: 'numeric', count: 545, identicalIds: false, identicalScores: false, maximumScoreError: 2e-7, top20Overlap: 19 },
  ] }, 'fidelity');
  assert.equal(fidelity.methods[0].comparisons, 2); assert.equal(fidelity.methods[0].identicalOrders, 1);
  assert.equal(fidelity.methods[0].minimumTop20Overlap, 19); assert.equal(fidelity.methods[0].maximumScoreError, 2e-7);
  const feedback = summarizeOptimizationFeedback({ candidates: [{ id: 'rank8', summary: { coverage: { error: 8 }, accuracy: { allPairs: { queryMacroAgreement: .7, assessedCases: 24 } } },
    cases: [{ caseId: 'case', status: 'error', reason: 'timeout' }] }] }, 'feedback');
  assert.equal(feedback.candidates[0].zeroCaseErrors, false); assert.equal(feedback.candidates[0].agreement.assessedCases, 24);
  assert.deepEqual(feedback.candidates[0].errors, [{ caseId: 'case', reason: 'timeout' }]);
});

test('index scope reads both old identity metadata and new full-bank metadata', () => {
  assert.equal(optimizationIndexSummary({ mapping: { _meta: { identity: { scope: 'projection' } } } }).scope, 'projection');
  assert.equal(optimizationIndexSummary({ mapping: { _meta: { scope: 'full' } } }).scope, 'full');
  assert.equal(optimizationIndexSummary({}).scope, 'unknown');
  assert.equal(optimizationIndexSummary({}).primaryStoreBytes, null);
  assert.equal(optimizationIndexSummary({}).sourceEnabled, null);
});

test('execution identity cannot hide a failed intended-arithmetic diagnostic', () => {
  const summary = summarizeOptimizationFidelity({ finishedAt: 'time', passed: false, executionPassed: true, intendedArithmeticPassed: false,
    expectedExecutions: 1, numericChecks: [{ queryId: 'duplicate', oraclePassed: false, maximumOracleError: .1 }],
    duplicateDiagnostics: [{ queryId: 'duplicate', intendedNumericOraclePassed: false }],
    rows: [{ method: 'sorted', count: 20, identicalIds: true, float32ScoresIdentical: true, transportScoresIdentical: false, maximumTransportDelta: 1e-9 }] }, 'execution');
  assert.equal(summary.complete, true); assert.equal(summary.passed, false); assert.equal(summary.executionPassed, true);
  assert.equal(summary.numericOracleFailures.length, 1); assert.equal(summary.duplicateDiagnostics.length, 1);
  assert.equal(summary.methods[0].identicalNumericScores, 1); assert.equal(summary.methods[0].identicalTransportScores, 0);
  assert.equal(summary.methods[0].maximumTransportDelta, 1e-9);
});

test('failed fidelity retains its cause and never becomes completed evidence', () => {
  const summary = summarizeOptimizationFidelity({ failedAt: 'time', error: 'Changed global ordering', rows: [{ method: 'bounded', count: 20 }] }, 'failure');
  assert.equal(summary.complete, false); assert.equal(summary.failure, 'Changed global ordering');
  assert.equal(summary.failedAt, 'time'); assert.equal(summary.methods[0].comparisons, 1);
});

test('fetch-only fidelity preserves combined identity flags and separates diagnostic timings', () => {
  const diagnostics = [{ method: 'numeric-docvalues', limit: 1000, stored: { elapsedMs: 5900 }, docvalues: { elapsedMs: 4 } }];
  const summary = summarizeOptimizationFidelity({ finishedAt: 'time', passed: true, diagnostics,
    rows: [{ method: 'numeric-docvalues', count: 545, identicalFloat32ScoresAndIds: true, rawScoresIdentical: true }] }, 'fetch');
  assert.equal(summary.methods[0].identicalOrders, 1);
  assert.equal(summary.methods[0].identicalNumericScores, 1);
  assert.equal(summary.methods[0].identicalTransportScores, 1);
  assert.deepEqual(summary.fetchDiagnostics, diagnostics);
  assert.equal(summary.methods[0].maximumScoreError, null);
});

test('maxima fidelity distinguishes original pruning from additional ranges', () => {
  const result = summarizeOptimizationFidelity({ finishedAt: 'time', passed: true, positiveBoundExecutions: 2,
    maximaRangeExecutions: 1, additionallyPrunedExecutions: 1,
    rows: [{ method: 'maxima', count: 20, identicalIds: true, float32ScoresIdentical: true,
      evidence: { globalBounds: { threshold: .4, maximaBounds: { addedRanges: 2 } } },
      pruning: { originalPruned: 10, additionallyPruned: 8, totalPruned: 18 } },
    { method: 'maxima', count: 20, identicalIds: true, float32ScoresIdentical: true,
      evidence: { globalBounds: { threshold: .4, maximaBounds: { addedRanges: 0 } } },
      pruning: { originalPruned: 10, additionallyPruned: 0, totalPruned: 10 } }] }, 'maxima');
  assert.equal(result.maximaRangeExecutions, 1); assert.equal(result.additionallyPrunedExecutions, 1);
  assert.equal(result.methods[0].positiveBoundExecutions, 2); assert.equal(result.methods[0].actuallyPrunedExecutions, 2);
  assert.equal(result.methods[0].maximaRangeExecutions, 1); assert.equal(result.methods[0].additionallyPrunedExecutions, 1);
});

test('inventory discovers separate future full and arrival campaigns and preserves failed receipts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'favorite-results-'));
  try {
    const fixtures = {
      'full/benchmark.json': { experiment: 'favorite-optimization-benchmark', finishedAt: 'time', profiles: [], indexBefore: [{ index: 'full', count: 1000000, mapping: { _meta: { scope: 'full' } } }] },
      'arrivals/arrival.json': { experiment: 'favorite-optimization-arrival', profiles: [] },
      'failed/index.json': { experiment: 'strict-hue-favorite-utilities', index: 'failed', indexed: 21, error: 'circuit breaker', configuration: { scope: 'full', count: 1000000, source: false } },
      'failed-fidelity/failure.json': { rows: [], failedAt: 'time', error: 'Changed global ordering' },
      'maxima/audit-independent.json': { kind: 'maxima-execution', summaryHash: 'summary', integrityPassed: true, experimentPassed: true, executions: 626 },
      'multishard/audit-independent-v2.json': { kind: 'multishard-execution', summarySha256: 'three-shard-summary', passed: true, executions: 1920, physicalNodeCount: 1 },
      'multiplicity-independent-audit-v1.json': { experiment: 'favorite-multiplicity-independent-audit', integrityPassed: true, fidelity: { actualDuplicateWeightCorrections: 135 } },
      'multiplicity/feedback.json': { experiment: 'favorite-multiplicity-feedback', finishedAt: 'time', passed: true, candidates: [] },
      'ignored/benchmark.json': { experiment: 'offline-encoder' },
    };
    for (const [relative, fixture] of Object.entries(fixtures)) {
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await writeFile(path.join(root, relative), JSON.stringify(fixture));
    }
    const result = await generateOptimizationResults({ root });
    assert.equal(result.performance.length, 2);
    assert.equal(result.performance.find(item => item.kind === 'closed-loop').indexes[0].scope, 'full');
    assert.equal(result.performance.find(item => item.kind === 'arrivals').complete, false);
    assert.equal(result.indexes[0].indexedCount, 21); assert.equal(result.indexes[0].count, null);
    assert.equal(result.indexes[0].failure, 'circuit breaker');
    assert.equal(result.indexes[0].complete, false); assert.equal(result.indexes[0].sourceEnabled, false);
    assert.equal(result.fidelity.length, 1); assert.equal(result.fidelity[0].failure, 'Changed global ordering');
    assert.equal(result.audits.length, 3); assert.equal(result.audits[0].kind, 'maxima-execution'); assert.equal(result.audits[0].executions, 626);
    assert.equal(result.audits.find(item => item.kind === 'multishard-execution').executions, 1920);
    assert.equal(result.audits.find(item => item.kind === 'multiplicity').fidelity.actualDuplicateWeightCorrections, 135);
    assert.equal(result.feedback.length, 1); assert.equal(result.feedback[0].accuracyOnly, true);
    const bytes = await readFile(path.join(root, 'failed/index.json'));
    assert.equal(result.indexes[0].artifact.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(bytes.toString(), JSON.stringify(fixtures['failed/index.json']));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI requires artifact root and supports explicit feedback evidence', () => {
  const config = optimizationResultsConfiguration(['--root', '/tmp/artifacts', '--feedback', '/tmp/run1.json', '--feedback', '/tmp/run2.json']);
  assert.equal(config.feedback.length, 2);
  assert.throws(() => optimizationResultsConfiguration([]));
  assert.throws(() => optimizationResultsConfiguration(['--root', '/tmp/a', '--root', '/tmp/b']));
});

test('multiplicity reports actual corrections separately from unchanged controls and ordinary parity', () => {
  const result = summarizeOptimizationFidelity({ experiment: 'favorite-utility-multiplicity-fidelity', method: 'corrected',
    finishedAt: 'time', passed: true, correctedExecutions: 2, distinctParentComparisons: 144, rows: [
      { phase: 'corrected', count: 20, exactIdsAndOrder: true, exactFloat32Scores: true, maxIdealMeanError: 1e-8, evidence: { multiplicity: { corrected: true } } },
      { phase: 'corrected', count: 20, exactIdsAndOrder: true, exactFloat32Scores: true, evidence: { multiplicity: { corrected: false } } },
      { phase: 'filtered-duplicates', count: 3, exactIdsAndScores: true },
    ] }, 'multiplicity');
  assert.equal(result.methods[0].method, 'corrected'); assert.equal(result.methods[0].identicalOrders, 3);
  assert.equal(result.methods[0].identicalNumericScores, 3);
  assert.deepEqual(result.multiplicity, { duplicateSuiteExecutions: 2, actualDuplicateWeightCorrections: 1,
    unchangedDuplicateSuiteControls: 1, distinctParentComparisons: 144, filteredComparisons: 1, maximumIdealMeanError: 1e-8 });
});

test('accuracy-only feedback normalizes its distinct schema without inventing timing', () => {
  const result = summarizeOptimizationFeedback({ experiment: 'favorite-multiplicity-feedback', startedAt: 'start', finishedAt: 'finish', passed: true,
    configuration: { directory: '/tmp/multiplicity-feedback-v1' }, sourceSnapshotHash: 'source', candidates: [{ id: 'corrected',
      metadata: { id: 'corrected' }, coverage: { ok: 32, unsupported: 6, errors: 0 }, cases: Array.from({ length: 38 }, () => ({})),
      accuracy: { allPairs: { queryMacroAgreement: .69 }, withoutUncertain: { queryMacroAgreement: .68 }, eligibilityViolations: 0 } }] }, 'feedback');
  assert.equal(result.accuracyOnly, true); assert.equal(result.complete, true); assert.equal(result.sourceSnapshotHash, 'source');
  assert.equal(result.runId, 'multiplicity-feedback-v1'); assert.equal(result.candidates[0].method, 'corrected');
  assert.deepEqual(result.candidates[0].coverage, { ok: 32, unsupported: 6, error: 0, total: 38 });
  assert.equal(result.candidates[0].agreement.queryMacroAgreement, .69); assert.equal(result.candidates[0].zeroCaseErrors, true);
  assert.equal(Object.hasOwn(result, 'performance'), false);
});

test('multishard summary keeps logical shards separate from physical node and capacity evidence', () => {
  const result = summarizeOptimizationFidelity({ experiment: 'favorite-multishard-fidelity', finishedAt: 'time', passed: true,
    referenceCases: 160, utilityCount: 189, shardCounts: [188, 186, 171], physicalNodes: ['one-node'], duplicateFallbacks: 6,
    rows: [{ method: 'maxima', count: 20, identicalIds: true, float32ScoresIdentical: true,
      bounds: { threshold: .4, maximaBounds: { addedRanges: 2 } } }] }, 'three-shards');
  assert.deepEqual(result.topology, { primaryShards: 3, documentsPerPrimaryShard: [188, 186, 171], physicalNodeCount: 1 });
  assert.equal(result.referenceCases, 160); assert.equal(result.duplicateFallbacks, 6);
  assert.equal(result.methods[0].positiveBoundExecutions, 1); assert.equal(result.methods[0].maximaRangeExecutions, 1);
});

async function interruptedEvidence(root, change = () => {}) {
  const timed = [{ phase: 'timed', requestId: 'finished:0', elapsedMs: 8 },
    { phase: 'timed', requestId: 'pending:0', elapsedMs: 5 },
    { phase: 'timed', requestId: 'pending:1', elapsedMs: 1200, error: 'fetch failed' }];
  const benchmark = { experiment: 'favorite-optimization-benchmark', configuration: { directory: root, count: 1e6 },
    interruption: { error: 'transport failed' }, profiles: [{ id: 'finished', trials: [timed[0]] }] };
  const plan = { version: 1 }, sources = { 'source.mjs': 'archived' };
  const objectHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const audit = { schemaVersion: 1, experiment: 'favorite-optimization-audit', directory: root,
    complete: false, integrityPassed: true, accepted: false, errorCount: 0, errors: [], profileCount: 1,
    rawRequestRows: 3, pendingTimedRows: 2, pendingWarmupRows: 0,
    totals: { timedRequests: 3, timedErrors: 1, timedOverOneSecond: 1, timedStrictFailures: 1,
      warmupRequests: 0, warmupErrors: 0, warmupOverOneSecond: 0, warmupStrictFailures: 0 },
    hashes: { benchmark: objectHash(benchmark), plan: objectHash(plan), archivedSources: objectHash(sources) } };
  change({ audit, benchmark, timed });
  for (const [name, object] of Object.entries({ 'benchmark.json': benchmark, 'plan.json': plan,
    'source-snapshot.json': sources, 'audit-independent.json': audit })) await writeFile(path.join(root, name), JSON.stringify(object, null, 2));
  await writeFile(path.join(root, 'requests.jsonl'), timed.map(row => JSON.stringify(row)).join('\n') + '\n');
}

test('incomplete campaign includes audited raw errors without inventing a finished profile or double-counting', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'favorite-pending-'));
  try {
    await interruptedEvidence(root);
    const result = await generateOptimizationResults({ root }), campaign = result.performance[0];
    assert.equal(campaign.complete, false); assert.equal(campaign.profiles.length, 1);
    assert.deepEqual(campaign.completedTimed, { requests: 1, errors: 0, atOrAboveOneSecond: 0, strictFailures: 0 });
    assert.deepEqual(campaign.timed, { requests: 3, errors: 1, atOrAboveOneSecond: 1, strictFailures: 1 });
    assert.deepEqual(campaign.pendingEvidence.timed, { requests: 2, errors: 1, atOrAboveOneSecond: 1, strictFailures: 1 });
    assert.equal(campaign.pendingEvidence.status, 'verified'); assert.equal(campaign.timedCoverage, 'audited-raw-log');
    assert.match(campaign.pendingEvidence.rawRequests.sha256, /^[a-f0-9]{64}$/);
    assert.equal(campaign.pendingEvidence.rawRequests.sha256, createHash('sha256').update(await readFile(path.join(root, 'requests.jsonl'))).digest('hex'));
    assert.equal(result.warnings.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stale, misrouted, malformed and raw-inconsistent audits cannot promote pending counts', async () => {
  const mutations = [({ audit }) => { audit.hashes.benchmark = '0'.repeat(64); },
    ({ audit }) => { audit.directory += '/other'; },
    ({ audit }) => { audit.pendingTimedRows = 1; },
    ({ audit }) => { audit.totals.timedErrors = -1; },
    ({ audit }) => { audit.totals.timedStrictFailures = 0; },
    ({ timed }) => { timed[2].error = undefined; timed[2].elapsedMs = 1; },
    ({ audit }) => { audit.integrityPassed = false; }];
  for (const mutate of mutations) {
    const root = await mkdtemp(path.join(tmpdir(), 'favorite-bad-pending-'));
    try {
      await interruptedEvidence(root, mutate);
      const result = await generateOptimizationResults({ root }), campaign = result.performance[0];
      assert.equal(campaign.pendingEvidence.status, 'unavailable'); assert.equal(campaign.pendingEvidence.timed, null);
      assert.equal(campaign.timedCoverage, 'completed-profiles-only'); assert.equal(campaign.timed.requests, 1);
      assert.ok(result.warnings.length > 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('an interrupted campaign with no independent audit exposes unknown pending totals', () => {
  const result = summarizeOptimizationPerformance({ profiles: [] }, 'file');
  assert.equal(result.pendingEvidence.status, 'unavailable'); assert.equal(result.pendingEvidence.timed, null);
  assert.equal(result.timedCoverage, 'completed-profiles-only');
});
