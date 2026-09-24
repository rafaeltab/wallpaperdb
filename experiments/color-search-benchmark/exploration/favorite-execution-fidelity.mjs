// Read-only execution fidelity campaign. Local comparisons are diagnostics;
// every candidate result is globally selected/ordered by OpenSearch.
import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIDELITY_QUERIES, compareFavoriteRankings } from './favorite-optimization-fidelity.mjs';
import { FAVORITE_PARAMETERS, FAVORITE_METHOD, loadFavoriteScaleInputs } from './favorite-scale-corpus.mjs';
import { loadHueDocuments } from './hue-index.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { createFavoriteUtilityPlan, buildFavoriteUtilityQuery, toFavoriteUtilityDocument, supportsFavoriteUtilities } from './favorite-utilities.mjs';
import { buildCutoffQuery } from './methods-cutoff.mjs';
import { searchFavoriteSortedUtilities } from './favorite-sorted-utilities.mjs';
import { executeFavoriteBoundedUtilitySearch } from './favorite-bounded-utilities.mjs';
import { BASE, api, searchIndex, validateSearchResponse, safeIndexName, hash } from './service.mjs';

const REPOSITORY = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const BASELINE_INDEX = 'color-exploration-shade-hue-256-real-v1';
export const EXECUTION_FIDELITY_METHODS = Object.freeze(['favorite-utility-sorted', 'favorite-utility-sorted-scored', 'favorite-utility-bounded']);
const allControls = () => [0, .5, 1].flatMap(qualityInfluence => [0, 1, 3].map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent })));
const favorite = { ...FAVORITE_PARAMETERS, bucketCount: 256 };

export function executionFidelityConfiguration(args = []) {
  const values = { allPresets: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--favorite-only') { values.allPresets = false; continue; }
    if (!['--directory', '--index'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Unknown or missing execution fidelity option: ' + args[i]);
    const key = args[i].slice(2); values[key] = args[++i];
  }
  if (!values.directory) throw Error('Provide --directory NEW_EXTERNAL_DIRECTORY.');
  const directory = path.resolve(values.directory);
  if (directory === path.parse(directory).root || directory === REPOSITORY || directory.startsWith(REPOSITORY + path.sep)) throw Error('Execution fidelity artifacts must use a new external directory.');
  return { directory, index: safeIndexName(values.index ?? 'color-exploration-favorite-points-real-v2'), allPresets: values.allPresets };
}

export function assertSameExecutionRanking(expected, actual, { exactScores = false } = {}) {
  assert.deepEqual(actual.map(hit => hit.id), expected.map(hit => hit.id), 'Global execution changed the service ordering or eligibility');
  let maximumTransportDelta = 0;
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Number.isFinite(actual[i].score) && Number.isFinite(expected[i].score));
    assert.equal(Math.fround(actual[i].score), Math.fround(expected[i].score), 'Execution changed a float32 utility score');
    if (exactScores) assert.equal(actual[i].score, expected[i].score, 'Unchanged native score query returned a different score');
    maximumTransportDelta = Math.max(maximumTransportDelta, Math.abs(actual[i].score - expected[i].score));
  }
  return { count: actual.length, identicalIds: true, float32ScoresIdentical: true,
    transportScoresIdentical: actual.every((hit, i) => hit.score === expected[i].score), maximumTransportDelta };
}

export function numericExecutionOracle(measurement, plan, body) {
  const indexed = toFavoriteUtilityDocument(measurement, plan, { encodings: ['numeric'] });
  let sum = 0;
  for (const clause of body.query.bool.should) {
    const factor = clause.function_score?.field_value_factor;
    assert.ok(factor && factor.modifier === 'none' && Number.isFinite(factor.factor));
    const [, key] = factor.field.split('.');
    assert.ok(Object.hasOwn(indexed.utilities, key), 'Missing numeric oracle utility');
    sum += Math.fround(indexed.utilities[key] * Math.fround(factor.factor));
  }
  return Math.fround(sum);
}

/** Return the final real service body and IDs, not an inferred candidate list. */
export function inspectBoundedExecution(result, trace, numericBody) {
  const searches = trace.filter(call => call.route.startsWith('_search?') || /\/_search\?/.test(call.route));
  assert.ok(searches.length, 'Bounded execution did not record a service search');
  const final = searches.at(-1), bounds = result.evidence?.globalBounds;
  assert.equal(bounds?.completeCandidateCoverage, true);
  assert.equal(bounds.consistency, 'point-in-time');
  assert.deepEqual(final.request.body.query.bool.should, numericBody.query.bool.should, 'Bounded final score clauses changed');
  const baselineFilters = numericBody.query.bool.filter;
  assert.deepEqual(final.request.body.query.bool.filter.slice(0, baselineFilters.length), baselineFilters, 'Bounded final metadata filters changed');
  const extra = final.request.body.query.bool.filter.slice(baselineFilters.length);
  if (bounds.threshold !== null && bounds.threshold > 0) {
    assert.equal(extra.length, 1, 'Expected one global utility-bound filter');
    assert.equal(extra[0].bool.minimum_should_match, 1);
    assert.ok(extra[0].bool.should.length > 0);
    for (const clause of extra[0].bool.should) {
      assert.ok(clause.range && Object.keys(clause.range).length === 1, 'Final bounds must be global numeric ranges, not seed IDs');
      const [field, range] = Object.entries(clause.range)[0];
      assert.ok(field.startsWith('utilities.')); assert.equal(range.gte, bounds.threshold);
    }
  } else assert.equal(extra.length, 0, 'A fallback must preserve the full numeric eligibility');
  const finalServiceHitIds = final.response.body.hits.hits.map(hit => hit.fields?.id?.[0] ?? hit._id);
  assert.deepEqual(finalServiceHitIds, result.hits.map(hit => hit.id));
  return { ...bounds, stageCount: result.evidence.stages?.length ?? searches.length,
    searchStageCount: searches.length, finalServiceHitIds, finalBody: final.request.body, positiveThresholdApplied: bounds.threshold > 0 };
}

export async function captureFavoriteExecution(method, options, { request = api } = {}) {
  assert.ok(EXECUTION_FIDELITY_METHODS.includes(method));
  const trace = [];
  const capture = async (route, settings = {}) => {
    const response = await request(route, settings);
    trace.push({ route, request: { method: settings.method ?? 'GET', body: settings.body, timeoutMs: settings.timeoutMs }, response });
    return response;
  };
  const search = async (index, body, settings = {}) => {
    const response = await capture(index + '/_search?request_cache=false', { ...settings, method: 'POST', body });
    return { hits: validateSearchResponse(response.body), totalEligible: response.body.hits.total?.value,
      evidence: { index, serviceTookMs: response.body.took, httpMs: response.wallMs } };
  };
  try {
    const result = method === 'favorite-utility-bounded'
      ? await executeFavoriteBoundedUtilitySearch({ ...options, request: capture })
      : await searchFavoriteSortedUtilities({ ...options, method }, { request: capture, search });
    return { result, trace };
  } catch (error) { error.executionTrace = trace; error.executionMethod = method; throw error; }
}

export function filteredExecutionCases(documents) {
  const ids = documents.map(document => document.id).sort();
  const idsSubset = ids.filter((_, i) => i % 7 === 0), exclusions = idsSubset.slice(0, 3);
  const cohort = documents.find(document => document.cohort)?.cohort;
  const shapes = FIDELITY_QUERIES.slice(0, 4);
  const cases = shapes.flatMap(item => [
    { id: 'eligible-excluded-' + item.id, query: item.query, eligibleIds: idsSubset, excludedIds: exclusions },
    { id: 'excluded-' + item.id, query: item.query, excludedIds: ids.slice(0, Math.min(30, ids.length)) },
    ...(cohort ? [{ id: 'cohort-' + item.id, query: item.query, filter: { term: { cohort } } }] : []),
  ]);
  cases.push({ id: 'empty-eligibility', query: shapes[0].query, eligibleIds: [] });
  const red = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
  const plan = createFavoriteUtilityPlan({ requests: [{ query: red, parameters: favorite }] });
  const body = buildFavoriteUtilityQuery({ query: red, parameters: favorite });
  const zeroIds = documents.filter(document => numericExecutionOracle(document, plan, body) === 0).map(document => document.id).sort().slice(0, 60);
  if (zeroIds.length >= 2) cases.push({ id: 'zero-score-ties', query: red, eligibleIds: zeroIds, zeroScores: true });
  return cases;
}

export function duplicateExecutionCases() {
  return [
    { id: 'duplicate-identical-red', colors: ['#ff0000', '#ff0000'] },
    { id: 'duplicate-nearby-red-anchor', colors: ['#ff0000', '#fe0000'] },
  ].map(item => {
    const query = { mode: 'proportions', targets: item.colors.map(color => ({ color, percent: 50 })) };
    const support = supportsFavoriteUtilities('favorite-utility-numeric', query, { parameters: favorite });
    assert.equal(support.supported, true); assert.equal(support.utilities.length, 2);
    assert.equal(support.utilities[0].key, support.utilities[1].key, 'Duplicate-anchor diagnostic colors must resolve to one utility');
    return { id: item.id, query, duplicateDiagnostic: true, resolvedUtilityKeys: support.utilities.map(target => target.key),
      equivalentSingleTarget: { mode: 'proportions', targets: [query.targets[0]] } };
  });
}

async function captureIndex(index) {
  const [count, mapping, settings, stats] = await Promise.all([api(index + '/_count'), api(index + '/_mapping'), api(index + '/_settings'), api(index + '/_stats/docs,indexing')]);
  const selected = settings.body[index]?.settings?.index, primary = stats.body.indices?.[index]?.primaries;
  assert.ok(selected?.uuid && primary?.indexing);
  const snapshot = { at: new Date().toISOString(), index, count: count.body.count, uuid: selected.uuid, mapping: mapping.body[index]?.mappings, settings: selected, stats: stats.body };
  snapshot.generation = { count: snapshot.count, uuid: snapshot.uuid, mappingHash: hash(snapshot.mapping), docs: primary.docs,
    indexingTotal: primary.indexing.index_total, deleteTotal: primary.indexing.delete_total };
  return snapshot;
}

export function assertExecutionIndex(snapshot, { sourceIdentityHash, documentsHash, plan, allPresets = true }) {
  const meta = snapshot.mapping?._meta;
  assert.equal(snapshot.count, 545); assert.ok(snapshot.uuid);
  assert.ok(['strict-hue-favorite-utilities', 'strict-hue-favorite-compiled-utilities'].includes(meta?.experiment));
  assert.equal(meta.utilityDefinitionVersion, 2); assert.equal(meta.numericPoints, true);
  assert.equal(meta.mode, 'real'); assert.equal(meta.scope, 'full'); assert.equal(meta.count, 545);
  assert.equal(meta.sourceIdentityHash, sourceIdentityHash); assert.equal(meta.sourceDocumentsHash, documentsHash);
  assert.ok(meta.encodings?.includes('numeric')); assert.equal(meta.planHash, hash(plan));
  if (allPresets) assert.equal(meta.presets, 'all');
  else assert.ok(['all', 'favorite'].includes(meta.presets));
  const fields = snapshot.mapping.properties?.utilities?.properties;
  assert.equal(Object.keys(fields ?? {}).length, plan.utilityCount);
  for (const descriptor of plan.descriptors) {
    const field = fields[descriptor.key];
    assert.equal(field?.type, 'float'); assert.notEqual(field.index, false); assert.notEqual(field.doc_values, false);
  }
}

export async function runFavoriteExecutionFidelity({ directory, index = 'color-exploration-favorite-points-real-v2', allPresets = true }) {
  const config = executionFidelityConfiguration(['--directory', directory, '--index', index, ...(allPresets ? [] : ['--favorite-only'])]);
  assert.equal(BASE, 'http://127.0.0.1:19216');
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  const save = (name, value) => writeFile(path.join(config.directory, name), JSON.stringify(value, null, 2), { flag: 'wx' });
  const append = (name, value) => appendFile(path.join(config.directory, name), JSON.stringify(value) + '\n');
  const result = { schemaVersion: 1, startedAt: new Date().toISOString(), configuration: config, methods: EXECUTION_FIDELITY_METHODS,
    rows: [], numericChecks: [], nativeComparisons: [], duplicateDiagnostics: [], positiveBoundExecutions: 0, actuallyPrunedExecutions: 0,
    limitations: ['Execution fidelity uses the retained545-asset corpus; it is not a million-document performance test or human relevance evaluation.',
      'Sort-value JSON transport can carry more decimal digits than float32 score JSON; float32 identity is checked separately from raw numeric identity.',
      'Bounded eligibility counts are measured after PIT closure on an index whose before/after generation must remain identical.'] };
  try {
    const sources = await favoriteSourceSnapshot(import.meta.url); result.sourceSnapshotHash = hash(sources); await save('source-snapshot.json', sources);
    const verified = await loadFavoriteScaleInputs({ scope: 'full', bucketCount: 256 }), documents = await loadHueDocuments(256);
    const ids = documents.map(document => document.id).sort(); assert.equal(ids.length, 545); assert.equal(new Set(ids).size, 545);
    result.sourceIdentityHash = verified.identityHash; result.documentsHash = hash(documents); result.source = verified.source;
    const before = { numeric: await captureIndex(config.index), native: await captureIndex(BASELINE_INDEX) };
    const completePlan = createFavoriteUtilityPlan({ presets: before.numeric.mapping?._meta?.presets === 'all' ? allControls() : [{}] });
    assertExecutionIndex(before.numeric, { sourceIdentityHash: verified.identityHash, documentsHash: result.documentsHash, plan: completePlan, allPresets });
    assert.equal(before.native.count, 545); assert.equal(before.native.mapping?._meta?.identityHash, verified.source.identityHash);
    result.before = before; await save('index-before.json', before);
    const presets = allPresets ? allControls() : [{}];
    const jobs = presets.flatMap(preset => FIDELITY_QUERIES.map(item => ({ ...item, parameters: { ...favorite, ...preset }, limits: [1000, 20, 3, 1], completeCorpus: true })));
    jobs.push(...duplicateExecutionCases().map(item => ({ ...item, parameters: favorite, limits: [1000, 20, 3, 1], completeCorpus: true })));
    const filtered = filteredExecutionCases(documents);
    assert.ok(filtered.some(item => item.id === 'zero-score-ties'), 'Retained corpus must provide a real zero-score tie case');
    jobs.push(...filtered.map(item => ({ ...item, parameters: favorite, limits: [20, 3, 1], completeCorpus: false })));
    result.expectedQueryPresetCombinations = FIDELITY_QUERIES.length * presets.length; result.filteredCases = filtered;
    result.expectedExecutions = jobs.reduce((count, item) => count + item.limits.length * EXECUTION_FIDELITY_METHODS.length, 0);
    for (const job of jobs) {
      const options = { query: job.query, parameters: job.parameters, eligibleIds: job.eligibleIds, excludedIds: job.excludedIds, filter: job.filter };
      const numericBody = buildFavoriteUtilityQuery({ ...options, limit: 1000 });
      const numeric = await searchIndex(config.index, numericBody);
      const plan = createFavoriteUtilityPlan({ requests: [{ query: job.query, parameters: job.parameters }] });
      const oracles = new Map(documents.map(document => [document.id, numericExecutionOracle(document, plan, numericBody)]));
      if (job.completeCorpus) assert.deepEqual(numeric.hits.map(hit => hit.id).sort(), ids);
      if (job.id === 'empty-eligibility') assert.equal(numeric.hits.length, 0);
      if (job.zeroScores) { assert.ok(numeric.hits.length >= 2); assert.ok(numeric.hits.every(hit => hit.score === 0)); }
      const maximumOracleError = Math.max(0, ...numeric.hits.map(hit => Math.abs(hit.score - oracles.get(hit.id))));
      const numericOraclePassed = maximumOracleError <= 2e-7;
      if (!job.duplicateDiagnostic) assert.ok(numericOraclePassed, 'Numeric service differs from utility arithmetic');
      result.numericChecks.push({ queryId: job.id, parameters: job.parameters, completeCorpus: job.completeCorpus, count: numeric.hits.length,
        maximumOracleError, oraclePassed: numericOraclePassed, duplicateDiagnostic: job.duplicateDiagnostic ?? false });
      const native = await searchIndex(BASELINE_INDEX, buildCutoffQuery({ ...options, method: FAVORITE_METHOD, limit: 1000 }));
      const nativeComparison = compareFavoriteRankings(native.hits, numeric.hits);
      if (!job.duplicateDiagnostic) assert.ok(nativeComparison.maximumScoreError <= 3e-7, 'Numeric utility differs beyond the native grouping allowance');
      result.nativeComparisons.push({ queryId: job.id, parameters: job.parameters, ...nativeComparison });
      await append('references.jsonl', { queryId: job.id, parameters: job.parameters, options, numericBody, numeric, native, oracles: Object.fromEntries(oracles) });
      if (job.duplicateDiagnostic) {
        const equivalent = { query: job.equivalentSingleTarget, parameters: job.parameters, limit: 1000 };
        const numericSingle = await searchIndex(config.index, buildFavoriteUtilityQuery(equivalent));
        const nativeSingle = await searchIndex(BASELINE_INDEX, buildCutoffQuery({ ...equivalent, method: FAVORITE_METHOD }));
        const diagnostic = { queryId: job.id, resolvedUtilityKeys: job.resolvedUtilityKeys, intendedNumericOraclePassed: numericOraclePassed,
          maximumIntendedNumericOracleError: maximumOracleError, numericRepeatedVersusSingle: compareFavoriteRankings(numericSingle.hits, numeric.hits),
          nativeRepeatedVersusSingle: compareFavoriteRankings(nativeSingle.hits, native.hits), nativeVersusNumeric: nativeComparison };
        result.duplicateDiagnostics.push(diagnostic);
        await append('duplicate-diagnostics.jsonl', { ...diagnostic, query: job.query, equivalentSingleTarget: job.equivalentSingleTarget,
          native, numeric, nativeSingle, numericSingle });
      }
      for (const limit of job.limits) for (const method of EXECUTION_FIDELITY_METHODS) {
        const captured = await captureFavoriteExecution(method, { ...options, index: config.index, limit, timeoutMs: 10000 });
        await append('service-traces.jsonl', { queryId: job.id, parameters: job.parameters, method, limit, ...captured });
        const comparison = assertSameExecutionRanking(numeric.hits.slice(0, limit), captured.result.hits, { exactScores: method !== 'favorite-utility-sorted' });
        const row = { queryId: job.id, parameters: job.parameters, method, limit, completeCorpus: job.completeCorpus, ...comparison, evidence: captured.result.evidence };
        if (method === 'favorite-utility-bounded') {
          const checked = inspectBoundedExecution(captured.result, captured.trace, buildFavoriteUtilityQuery({ ...options, limit }));
          row.bounds = { ...checked }; delete row.bounds.finalBody;
          if (checked.positiveThresholdApplied) {
            result.positiveBoundExecutions++;
            const count = (await api(config.index + '/_count', { method: 'POST', body: { query: { bool: { filter: checked.finalBody.query.bool.filter } } } })).body.count;
            assert.ok(count >= captured.result.hits.length && count <= numeric.hits.length);
            row.bounds.boundEligibleCount = count; row.bounds.totalEligibleCount = numeric.hits.length; row.bounds.prunedCount = numeric.hits.length - count;
            if (count < numeric.hits.length) result.actuallyPrunedExecutions++;
          }
        }
        result.rows.push(row);
        await append('executions.jsonl', { ...row, result: captured.result });
      }
      const progress = { queryId: job.id, parameters: job.parameters, completedQueries: result.numericChecks.length, completedExecutions: result.rows.length,
        positiveBoundExecutions: result.positiveBoundExecutions, actuallyPrunedExecutions: result.actuallyPrunedExecutions };
      await append('progress.jsonl', progress); console.log(JSON.stringify(progress));
    }
    result.after = { numeric: await captureIndex(config.index), native: await captureIndex(BASELINE_INDEX) }; await save('index-after.json', result.after);
    for (const key of ['numeric', 'native']) assert.deepEqual(result.after[key].generation, before[key].generation, 'Index generation changed during execution checks');
    assert.equal(hash(await favoriteSourceSnapshot(import.meta.url)), result.sourceSnapshotHash, 'Execution fidelity sources changed');
    assert.equal(result.rows.length, result.expectedExecutions); assert.ok(result.positiveBoundExecutions > 0); assert.ok(result.actuallyPrunedExecutions > 0);
    result.finishedAt = new Date().toISOString(); result.executionPassed = true;
    result.intendedArithmeticPassed = result.numericChecks.every(check => check.oraclePassed);
    result.passed = result.executionPassed && result.intendedArithmeticPassed;
    await save('fidelity.json', result); return result;
  } catch (error) {
    await save('failure.json', { ...result, failedAt: new Date().toISOString(), error: String(error.stack ?? error),
      failedExecution: { method: error.executionMethod, trace: error.executionTrace, evidence: error.evidence } }); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runFavoriteExecutionFidelity(executionFidelityConfiguration(process.argv.slice(2)));
