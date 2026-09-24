import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { auditOptimizationArrivalEvidence, independentlySummarizeOptimizationArrivals, independentlyCountArrivalCoverage,
  independentlyAuditMaximaArrivalBinding, independentlyAuditPooledArrivalBinding } from './favorite-optimization-arrival-audit.mjs';
import { optimizationArrivalQueries, compileOptimizationArrivalPlans, optimizationArrivalTrialIdentity,
  summarizeOptimizationArrivalCoverage, summarizeOptimizationArrival } from './favorite-optimization-arrival.mjs';
import { buildFavoriteUtilityQuery, createFavoriteUtilityPlan, favoriteUtilityMapping } from './favorite-utilities.mjs';
import { FAVORITE_PRESET_WORKLOAD } from './favorite-preset-workload.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fullPlan = createFavoriteUtilityPlan();

function evidence(durationMs = 30000, allPresets = false) {
  const candidate = { id: 'numeric', method: 'favorite-utility-numeric', index: 'color-exploration-audit-test', parameters: { bucketCount: 256, ...(allPresets ? { qualityInfluence: .5, cutoffBlendExponent: 1 } : {}) },
    builder: { module: './favorite-utilities.mjs', export: 'buildFavoriteUtilityQuery' } };
  const sources = { 'exploration/favorite-utilities.mjs': "import './shared.mjs';\nexport function buildFavoriteUtilityQuery(){}", 'exploration/shared.mjs': 'export const x=1;' };
  const fixed = optimizationArrivalQueries('fixed'), queries = optimizationArrivalQueries(allPresets ? 'presets-fixed' : 'fixed');
  const queryPlans = compileOptimizationArrivalPlans(candidate, queries, buildFavoriteUtilityQuery), primaryQueryPlans = compileOptimizationArrivalPlans(candidate, fixed, buildFavoriteUtilityQuery);
  const primaryCandidates = allPresets ? FAVORITE_PRESET_WORKLOAD.presets.map(preset => ({ ...candidate,
    id: preset.id === 'q050_w1' ? candidate.id : candidate.id + '-' + preset.id.replace('_', '-'), parameters: { ...candidate.parameters, ...preset.parameters } })) : [candidate];
  const mapping = favoriteUtilityMapping(fullPlan, { source: false, encodings: ['numeric'] }).mappings;
  mapping._meta = { scope: 'full', presets: allPresets ? 'all' : 'favorite' };
  const state = { index: candidate.index, count: 1000000, uuid: 'uuid', mapping, mappingHash: hash(canonical(mapping)), metadataHash: hash(canonical(mapping._meta)), indexing: { index_total: 1000000, delete_total: 0 } };
  const primary = { experiment: 'favorite-optimization-benchmark', finishedAt: '2026-09-23T12:00:00Z', configuration: { count: 1000000 }, candidates: primaryCandidates,
    sourceHashes: Object.fromEntries(Object.entries(sources).map(([file, text]) => [file, hash(text)])),
    queryPlans: primaryCandidates.flatMap(sibling => compileOptimizationArrivalPlans(sibling, fixed, buildFavoriteUtilityQuery).map(plan => ({ candidateId: sibling.id, caseId: sibling.id + ':' + plan.queryId, index: sibling.index, body: plan.body, bodyHash: hash(plan.body) }))),
    profiles: primaryCandidates.flatMap(sibling => fixed.map(query => ({ candidateId: sibling.id, queryId: query.id, selectivity: 'all', concurrency: 1, viableAtTestedLoad: true,
      minimumRequests: 32, requestedDurationMs: 10000, elapsedMs: 10000, trials: Array.from({ length: 32 }, (_, ordinal) => ({ ordinal, elapsedMs: 5 })) }))),
    warmups: primaryCandidates.flatMap(sibling => fixed.map(query => ({ candidateId: sibling.id, caseId: sibling.id + ':' + query.id, trials: [{ elapsedMs: 5 }] }))), indexAfter: [state] };
  const primaryBytes = JSON.stringify(primary), expectedUtilityKeys = allPresets
    ? FAVORITE_PRESET_WORKLOAD.presets.flatMap(preset => fullPlan.descriptors.map(item => item.key.replace(/q050_w1$/, preset.id)))
    : fullPlan.descriptors.map(item => item.key);
  const coverage = trials => summarizeOptimizationArrivalCoverage({ trials, queryPlans, expectedUtilityKeys, includePresets: allPresets });
  const configuration = { rates: [8, 32], durationMs, maxInFlight: 128, limit: 20, serviceTimeoutMs: 950, clientTimeoutMs: 1500, workload: allPresets ? 'presets-fixed' : 'fixed' };
  const plan = { experiment: 'favorite-optimization-arrival', configuration, sourceSnapshotHash: hash(sources), primaryArtifactHash: hash(primaryBytes), selection: { selected: [candidate], omitted: [] },
    queries, queryPlans, primaryQueryPlans,
    primaryValidation: [{ candidateId: candidate.id, sourceFiles: Object.keys(sources), executorSourceFiles: [], verifiedPlans: primaryQueryPlans.map(plan => ({ queryId: plan.queryId, bodyHash: hash(plan.body) })) }],
    utilityBanks: [{ candidateId: candidate.id, expectedUtilityKeys, expectedUtilityKeyCount: expectedUtilityKeys.length }],
    warmupPlan: { count: queries.length, queryOrdinals: queries.map((_, i) => i) },
    ...(allPresets ? { presetWorkloadDefinition: FAVORITE_PRESET_WORKLOAD,
      presetPrimaryValidation: [{ candidateId: candidate.id, presets: primaryCandidates.map((sibling, i) => {
        const plans = compileOptimizationArrivalPlans(sibling, fixed, buildFavoriteUtilityQuery);
        return { presetId: FAVORITE_PRESET_WORKLOAD.presets[i].id, primaryCandidateId: sibling.id, queryPlans: plans,
          validation: { candidateId: sibling.id, sourceFiles: Object.keys(sources), executorSourceFiles: [], verifiedPlans: plans.map(plan => ({ queryId: plan.queryId, bodyHash: hash(plan.body) })) } };
      }) }] } : {}) };
  const warmups = queries.map((item, ordinal) => ({ candidateId: candidate.id, phase: 'warmup', ordinal, elapsedMs: 5, schedulerDelayMs: 0, serviceTookMs: 2, hitCount: 20, hitsHash: hash(item.id), ...optimizationArrivalTrialIdentity(candidate, queries, ordinal) }));
  const all = [], profiles = []; let offset = 0;
  for (const rate of configuration.rates) {
    const trials = Array.from({ length: rate * durationMs / 1000 }, (_, ordinal) => ({ candidateId: candidate.id, phase: 'timed', rate, ordinal, elapsedMs: 5, requestMs: 4, schedulerDelayMs: 1,
      hitCount: 20, hitsHash: hash(queries[(offset + ordinal) % queries.length].id), ...optimizationArrivalTrialIdentity(candidate, queries, offset + ordinal) }));
    all.push(...trials);
    profiles.push({ ...summarizeOptimizationArrival(trials, warmups), candidateId: candidate.id, rate, durationMs, elapsedMs: durationMs, maxInFlight: 128, peakInFlight: 2,
      measuredWindowMs: durationMs, startingQueryOffset: offset, nextQueryOffset: offset + trials.length, trials, coverage: coverage(trials), cumulativeTimedCoverage: coverage(all) });
    offset += trials.length;
  }
  const result = { ...plan, planHash: hash(plan), startedAt: '2026-09-23T12:01:00Z', finishedAt: '2026-09-23T12:03:00Z', indexBefore: [state], indexAfter: [state], warmups,
    profiles, skipped: [], warmupCoverage: [{ candidateId: candidate.id, ...coverage(warmups) }], candidateCoverage: [{ candidateId: candidate.id, ...coverage(all) }] };
  return { plan, result, sources, primary, primaryBytes, rawRequests: [...warmups, ...all] };
}

test('independent arrival summary includes errors and rejected requests in latency and strict failure unions', () => {
  const rows = [{ elapsedMs: 10, schedulerDelayMs: 1 }, { elapsedMs: 1100, schedulerDelayMs: 3, error: 'timeout' }, { elapsedMs: 30, schedulerDelayMs: 30, error: 'full', clientRejected: true }];
  const summary = independentlySummarizeOptimizationArrivals(rows, [{ elapsedMs: 1200 }]);
  assert.equal(summary.p95Ms, 1100); assert.equal(summary.strictTimedFailures, 2); assert.equal(summary.strictWarmupFailures, 1);
  assert.equal(summary.strictFailures, 3); assert.equal(summary.clientRejected, 1); assert.equal(summary.viableAtTestedLoad, false);
});

test('independent maxima binding audit requires the exact executor, float points, ID doc values and warmup stages', () => {
  const input = {
    candidate: { method: 'favorite-utility-maxima-bounded', builder: { module: './favorite-maxima-bounded-utilities.mjs', export: 'buildFavoriteMaximaBoundedQuery' },
      executor: { module: './favorite-maxima-bounded-utilities.mjs', export: 'executeFavoriteMaximaBoundedUtilitySearch' } },
    state: { mapping: { _meta: { numericPoints: true, encodings: ['numeric'] }, properties: { id: { type: 'keyword' }, utilities: { properties: { a: { type: 'float' } } } } } },
    validation: { encoding: 'numeric', numericPointsRequired: true, docvalueIdRequired: true, boundDefinition: { version: 1, parentMethod: 'favorite-utility-bounded' } },
    warmups: [{ executionEvidence: { stages: [{ phase: 'pit-open' }, { phase: 'seed-0' }, { phase: 'global-final' }, { phase: 'pit-close' }],
      globalBounds: { maximaBounds: { maxima: { a: .8 }, thresholds: [], addedRanges: 0, fallback: null } } } }],
  };
  assert.deepEqual(independentlyAuditMaximaArrivalBinding(input), []);
  for (const mutate of [
    data => { delete data.candidate.executor; }, data => { data.validation.boundDefinition.version = 2; },
    data => { data.state.mapping._meta.numericPoints = false; }, data => { data.state.mapping.properties.utilities.properties.a.index = false; },
    data => { data.state.mapping.properties.id.doc_values = false; }, data => { delete data.warmups[0].executionEvidence; },
  ]) {
    const data = structuredClone(input); mutate(data);
    assert.ok(independentlyAuditMaximaArrivalBinding(data).length);
  }
  const failedWarmup = structuredClone(input); failedWarmup.warmups = [{ error: 'request failed' }];
  assert.deepEqual(independentlyAuditMaximaArrivalBinding(failedWarmup), []);
});

test('file evidence audit accepts a complete internally consistent arrival campaign', () => {
  const result = auditOptimizationArrivalEvidence(evidence());
  assert.equal(result.accepted, true, JSON.stringify(result.errors));
  assert.equal(result.profileCount, 2); assert.equal(result.rawRequestRows, 1204);
  assert.equal(result.failedProfiles, 0);
});

test('mixed-preset audit independently binds every preset approval and actual per-preset evidence', () => {
  const data = evidence(1000, true), report = auditOptimizationArrivalEvidence(data);
  assert.equal(report.accepted, true, JSON.stringify(report.errors));
  assert.equal(data.result.profiles[0].coverage.presets.length, 9);
  for (const mutate of [
    item => { item.result.profiles[0].coverage.presets[0].successfulUtilityKeyCount += 1; },
    item => { item.result.profiles[0].coverage.presets[0].strictFailures += 1; },
    item => { item.plan.presetPrimaryValidation[0].presets[0].primaryCandidateId = 'numeric'; },
    item => { item.plan.queries[0].parameters.qualityInfluence = 1; },
  ]) {
    const changed = structuredClone(data); mutate(changed);
    changed.result.planHash = hash(changed.plan);
    const audit = auditOptimizationArrivalEvidence(changed);
    assert.equal(audit.accepted, false); assert.ok(audit.errors.some(error => /preset|Preset|coverage|parameters/i.test(error)), audit.errors.join('\n'));
  }
});

test('mixed-preset audit refuses failed sibling C1 even if aggregate primary flags say viable', () => {
  const data = evidence(1000, true);
  data.primary.profiles[0].trials[0].elapsedMs = 1000;
  data.primaryBytes = JSON.stringify(data.primary); data.plan.primaryArtifactHash = hash(data.primaryBytes);
  data.result.primaryArtifactHash = data.plan.primaryArtifactHash; data.result.planHash = hash(data.plan);
  const report = auditOptimizationArrivalEvidence(data);
  assert.equal(report.accepted, false); assert.ok(report.errors.some(error => /preset.*C1|C1.*preset/i.test(error)), report.errors.join('\n'));
});

test('audit derives scheduled counts and window checks from the configured1..600 second duration', () => {
  for (const duration of [1000, 600000]) {
    const data = evidence(duration), report = auditOptimizationArrivalEvidence(data);
    assert.equal(report.accepted, true, JSON.stringify(report.errors));
    assert.equal(report.rawRequestRows, 4 + 40 * duration / 1000);
    data.result.profiles[0].durationMs = 30000;
    assert.equal(auditOptimizationArrivalEvidence(data).accepted, false);
  }
  for (const duration of [0, 1500, 601000]) {
    const data = evidence(); data.plan.configuration.durationMs = duration; data.result.planHash = hash(data.plan);
    assert.equal(auditOptimizationArrivalEvidence(data).accepted, false);
  }
});

test('audit catches changed summary counters, missing raw requests and restarted query offsets', () => {
  for (const corrupt of [
    data => { data.result.profiles[0].strictFailures = 1; },
    data => { data.rawRequests.pop(); },
    data => { data.result.profiles[1].startingQueryOffset = 0; },
  ]) {
    const data = structuredClone(evidence()); corrupt(data);
    const result = auditOptimizationArrivalEvidence(data);
    assert.equal(result.accepted, false); assert.ok(result.errors.length);
  }
});

test('audit derives actual utility keys from bodies and rejects inflated successful coverage', () => {
  const data = evidence();
  data.result.profiles[0].coverage.successful.fullUtilityBankCovered = true;
  assert.equal(auditOptimizationArrivalEvidence(data).accepted, false);
  const other = evidence(); other.result.queryPlans[0].utilityKeys = ['invented'];
  assert.equal(auditOptimizationArrivalEvidence(other).accepted, false);
  const plans = data.plan.queryPlans, trials = data.result.profiles[0].trials.slice(0, 3).map(row => ({ ...row }));
  trials[1].error = 'timeout'; trials[2].clientRejected = true; trials[2].error = 'full';
  const coverage = independentlyCountArrivalCoverage(trials, plans, data.plan.utilityBanks[0].expectedUtilityKeys);
  assert.equal(coverage.successful.requests, 1); assert.equal(coverage.dispatched.requests, 2);
  assert.equal(coverage.successful.utilityKeyCount, 1);
});

test('audit rejects missing warmups, changed merged parameters and hidden warmup failures', () => {
  for (const corrupt of [
    data => { data.result.warmups.pop(); },
    data => { data.result.profiles[0].trials[0].parameters.qualityInfluence = 1; },
    data => { data.result.warmups[0].error = 'timeout'; },
  ]) {
    const data = structuredClone(evidence()); corrupt(data);
    assert.equal(auditOptimizationArrivalEvidence(data).accepted, false);
  }
});

test('audit binds recursive source dependencies and fixed plans to primary evidence', () => {
  for (const corrupt of [
    data => { data.sources['exploration/shared.mjs'] = 'changed'; data.plan.sourceSnapshotHash = hash(data.sources); data.result.sourceSnapshotHash = data.plan.sourceSnapshotHash; data.result.planHash = hash(data.plan); },
    data => { data.primary.queryPlans[0].body.query = { match_all: {} }; data.primary.queryPlans[0].bodyHash = hash(data.primary.queryPlans[0].body); },
    data => { data.primary.profiles[0].trials[0].elapsedMs = 1000; },
  ]) {
    const data = structuredClone(evidence()); corrupt(data);
    data.primaryBytes = JSON.stringify(data.primary); data.plan.primaryArtifactHash = hash(data.primaryBytes); data.result.primaryArtifactHash = data.plan.primaryArtifactHash; data.result.planHash = hash(data.plan);
    assert.equal(auditOptimizationArrivalEvidence(data).accepted, false);
  }
});

test('an unfinished campaign never receives accepted status even if completed evidence is consistent', () => {
  const data = evidence(); delete data.result.finishedAt;
  const result = auditOptimizationArrivalEvidence(data);
  assert.equal(result.complete, false); assert.equal(result.accepted, false);
});

test('wide warmup failure remains accepted evidence only when all64 attempts and skipped rates are preserved', () => {
  const data = evidence(), candidate = data.plan.selection.selected[0], queries = optimizationArrivalQueries('wide');
  const queryPlans = compileOptimizationArrivalPlans(candidate, queries, buildFavoriteUtilityQuery);
  const ordinals = Array.from({ length: 64 }, (_, i) => Math.floor(i * (queries.length - 1) / 63));
  Object.assign(data.plan, { configuration: { ...data.plan.configuration, workload: 'wide' }, queries, queryPlans, warmupPlan: { count: 64, queryOrdinals: ordinals } });
  const warmups = ordinals.map((offset, ordinal) => ({ candidateId: candidate.id, phase: 'warmup', ordinal, elapsedMs: 5, schedulerDelayMs: 0,
    ...(ordinal === 0 ? { error: 'Service rejected warmup' } : { hitCount: 20, hitsHash: hash(queries[offset].id) }), ...optimizationArrivalTrialIdentity(candidate, queries, offset) }));
  Object.assign(data.result, data.plan, { planHash: hash(data.plan), profiles: [], warmups, candidateCoverage: [],
    warmupCoverage: [{ candidateId: candidate.id, ...summarizeOptimizationArrivalCoverage({ trials: warmups, queryPlans, expectedUtilityKeys: data.plan.utilityBanks[0].expectedUtilityKeys }) }],
    skipped: [{ candidateId: candidate.id, rates: [8, 32], reason: 'Warmup failed strict limit.' }] });
  data.rawRequests = warmups;
  const good = auditOptimizationArrivalEvidence(data);
  assert.equal(good.accepted, true, JSON.stringify(good.errors));
  data.result.warmups = warmups.slice(0, 1); data.rawRequests = data.result.warmups;
  assert.equal(auditOptimizationArrivalEvidence(data).accepted, false);
});

test('audit accepts sub-millisecond padding wakeup but rejects a window ending before its last scheduled slot', () => {
  const data = evidence(); data.result.profiles[0].measuredWindowMs = 29999.5;
  assert.equal(auditOptimizationArrivalEvidence(data).accepted, true);
  data.result.profiles[0].measuredWindowMs = 29000;
  assert.equal(auditOptimizationArrivalEvidence(data).accepted, false);
});

test('independent pooled audit requires actual native cleanup witness for both exact methods', () => {
  for (const method of ['favorite-utility-bounded-pooled-delete', 'favorite-utility-maxima-bounded-pooled-delete']) {
    const input = {
      candidate: { method, builder: { module: './favorite-pooled-utilities.mjs', export: 'buildFavoritePooledQuery' }, executor: { module: './favorite-pooled-utilities.mjs', export: 'executeFavoritePooledUtilitySearch' } },
      state: { mapping: { _meta: { numericPoints: true, encodings: ['numeric'] }, properties: { id: { type: 'keyword' }, utilities: { properties: { a: { type: 'float' } } } } } },
      validation: { encoding: 'numeric', numericPointsRequired: true, docvalueIdRequired: true,
        boundDefinition: { version: 1, parentMethod: 'favorite-utility-bounded' },
        transportDefinition: { version: 1, transport: { kind: 'favorite-pooled-pit-delete', version: 1, retries: 0 } } },
      warmups: [{ executionEvidence: { method, parentMethod: method.replace('-pooled-delete', ''), stages: [{ phase: 'pit-open' }, { phase: 'global-final' }, { phase: 'pit-close' }],
        globalBounds: { maximaBounds: { thresholds: [] } }, transport: { kind: 'favorite-pooled-pit-delete', version: 1, nativeDeleteRequests: 1, nativeDeleteResponses: 1, attempts: 1, reusedConnections: 0 } } }],
    };
    assert.deepEqual(independentlyAuditPooledArrivalBinding(input), []);
    for (const mutate of [data => { delete data.candidate.executor; }, data => { data.candidate.method += '-unknown'; },
      data => { data.state.mapping.properties.id.doc_values = false; }, data => { data.state.mapping.properties.utilities.properties.a.index = false; },
      data => { delete data.warmups[0].executionEvidence.transport; }, data => { data.warmups[0].executionEvidence.transport.attempts = 2; },
      data => { data.validation.transportDefinition.transport.retries = 1; }]) {
      const altered = structuredClone(input); mutate(altered); assert.ok(independentlyAuditPooledArrivalBinding(altered).length);
    }
  }
});

test('failed final arrival stats retain complete trials but cannot qualify or justify further rates', () => {
  const data = evidence();
  delete data.result.finishedAt; data.result.interruption = { at: '2026-09-23T12:01:00Z', error: 'fetch failed' };
  const profile = data.result.profiles.at(-1);
  Object.assign(profile, { measurementComplete: true, finalResourceCollectionComplete: false, after: null, cpuMs: null, clientCpuMs: null,
    resourceCollectionError: { error: 'fetch failed' }, resourceErrors: 1, viableAtTestedLoad: false });
  let audit = auditOptimizationArrivalEvidence(data);
  assert.equal(audit.integrityPassed, true, JSON.stringify(audit.errors)); assert.equal(audit.accepted, false);
  assert.equal(audit.pendingRawRows, 0); assert.equal(audit.incompleteResourceProfiles, 1);
  profile.viableAtTestedLoad = true;
  audit = auditOptimizationArrivalEvidence(data); assert.ok(audit.errors.some(error => error.includes('viableAtTestedLoad')));
  profile.viableAtTestedLoad = false; profile.cpuMs = 1;
  audit = auditOptimizationArrivalEvidence(data); assert.ok(audit.errors.some(error => error.includes('resource')));
});
