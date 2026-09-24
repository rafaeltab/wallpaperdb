// Read-only execution fidelity. OpenSearch selects and orders all rankings.
// The comparison oracle is the unchanged numeric query with doc-value ID fetch.
import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIDELITY_QUERIES } from './favorite-optimization-fidelity.mjs';
import { FAVORITE_PARAMETERS, loadFavoriteScaleInputs } from './favorite-scale-corpus.mjs';
import { loadHueDocuments } from './hue-index.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { createFavoriteUtilityPlan, buildFavoriteUtilityQuery } from './favorite-utilities.mjs';
import { filteredExecutionCases, duplicateExecutionCases, assertExecutionIndex, assertSameExecutionRanking } from './favorite-execution-fidelity.mjs';
import { buildFavoriteDocvalueQuery, searchFavoriteDocvalueUtilities } from './favorite-docvalue-fetch.mjs';
import { executeFavoriteMaximaBoundedUtilitySearch } from './favorite-maxima-bounded-utilities.mjs';
import { api, BASE, hash, safeIndexName } from './service.mjs';

const repository = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const method = 'favorite-utility-maxima-bounded';
const controls = () => [0, .5, 1].flatMap(qualityInfluence => [0, 1, 3].map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent })));
const favorite = { ...FAVORITE_PARAMETERS, bucketCount: 256 };
export function maximaFidelityConfiguration(args = []) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    assert.ok(['--index', '--directory'].includes(key) && value && !value.startsWith('--'), 'Use --directory and optional --index.');
    assert.ok(!Object.hasOwn(values, key), 'Repeated option: ' + key); values[key] = value;
  }
  assert.ok(values['--directory'], 'Provide a new external --directory.');
  const directory = path.resolve(values['--directory']);
  assert.ok(directory !== path.parse(directory).root && directory !== repository && !directory.startsWith(repository + path.sep), 'Use an external artifact directory.');
  return { directory, index: safeIndexName(values['--index'] ?? 'color-exploration-favorite-points-real-v2') };
}

export function maximaFidelityJobs(documents) {
  const filtered = filteredExecutionCases(documents);
  assert.ok(filtered.some(item => item.zeroScores), 'Corpus must provide a natural zero-score tie case.');
  return [
    ...controls().flatMap(preset => FIDELITY_QUERIES.map(item => ({ ...item, parameters: { ...favorite, ...preset }, limits: [1000, 20, 3, 1], completeCorpus: true }))),
    ...duplicateExecutionCases().map(item => ({ ...item, parameters: favorite, limits: [1000, 20, 3, 1], completeCorpus: true })),
    ...filtered.map(item => ({ ...item, parameters: favorite, limits: [20, 3, 1], completeCorpus: false })),
  ];
}

export async function captureMaximaExecution(options, { request = api, execute = executeFavoriteMaximaBoundedUtilitySearch } = {}) {
  const trace = [];
  const capture = async (route, settings = {}) => {
    const row = { route, request: { method: settings.method ?? 'GET', body: settings.body, timeoutMs: settings.timeoutMs } };
    trace.push(row);
    try { const response = await request(route, settings); row.response = response; return response; }
    catch (error) { row.error = String(error.stack ?? error); throw error; }
  };
  try { return { result: await execute({ ...options, request: capture }), trace }; }
  catch (error) { error.executionTrace = trace; throw error; }
}

/** Inspect the service request, rather than infer a shortlist from output hits. */
export function inspectMaximaExecution(result, trace, numericBody) {
  const searches = trace.filter(row => row.route.startsWith('_search?'));
  assert.ok(searches.length > 0, 'Missing actual maxima search requests.');
  const final = searches.at(-1), body = final.request.body, bounds = result.evidence?.globalBounds, maxima = bounds?.maximaBounds;
  assert.equal(bounds?.completeCandidateCoverage, true); assert.equal(bounds.consistency, 'point-in-time');
  assert.ok(maxima && Array.isArray(maxima.thresholds));
  assert.deepEqual(body.query.bool.should, numericBody.query.bool.should, 'Maxima changed numeric scoring clauses.');
  assert.deepEqual(body.query.bool.must, numericBody.query.bool.must); assert.deepEqual(body.sort, numericBody.sort);
  assert.equal(body.size, numericBody.size); assert.equal(body.stored_fields, '_none_'); assert.deepEqual(body.docvalue_fields, ['id']);
  const originalFilters = numericBody.query.bool.filter, extra = body.query.bool.filter.slice(originalFilters.length);
  assert.deepEqual(body.query.bool.filter.slice(0, originalFilters.length), originalFilters, 'Maxima changed metadata eligibility.');
  const fields = [...new Set(numericBody.query.bool.should.map(term => term.function_score.field_value_factor.field))];
  let orFilters = [...originalFilters];
  if (bounds.threshold > 0) {
    const expectedOr = { bool: { should: fields.map(field => ({ range: { [field]: { gte: bounds.threshold } } })), minimum_should_match: 1 } };
    assert.deepEqual(extra[0], expectedOr, 'Missing original global OR bound.');
    orFilters.push(expectedOr);
    const expectedAnds = maxima.thresholds.map(({ field, threshold }) => {
      assert.ok(fields.includes(field)); assert.ok(Number.isFinite(threshold) && threshold > 0 && threshold <= 1);
      return { range: { [field]: { gte: threshold } } };
    });
    assert.deepEqual(extra.slice(1), expectedAnds, 'Final query contains unexpected pruning or seed IDs.');
    assert.equal(maxima.addedRanges, expectedAnds.length);
    if (fields.length !== numericBody.query.bool.should.length) {
      assert.equal(maxima.fallback, 'duplicate-utility-fields'); assert.equal(maxima.addedRanges, 0);
    }
  } else { assert.equal(extra.length, 0); assert.equal(maxima.addedRanges, 0); }
  // Each seed must cover the same metadata filter and sort the matching field globally.
  const seeds = searches.filter(row => row.request.body.track_scores === false);
  assert.equal(seeds.length, fields.length);
  for (let i = 0; i < seeds.length; i++) {
    assert.deepEqual(seeds[i].request.body.query, { bool: { filter: originalFilters } }, 'Seed query is not globally eligible.');
    assert.deepEqual(seeds[i].request.body.sort, [{ [fields[i]]: { order: 'desc', missing: 0 } }, { id: 'asc' }]);
    const first = seeds[i].response?.body.hits.hits[0];
    if (first) assert.equal(maxima.maxima[fields[i]], Math.fround(first.sort[0]), 'Claimed maximum differs from service sort value.');
  }
  const opened = trace.find(row => row.route.includes('/_search/point_in_time?'));
  assert.ok(opened?.response?.body?.pit_id, 'PIT creation was not captured.');
  let pit = opened.response.body.pit_id;
  const usedPits = new Set([pit]);
  for (const row of searches) {
    assert.equal(row.request.body.pit?.id, pit, 'Search escaped the captured PIT sequence.');
    if (row.response?.body.pit_id) { pit = row.response.body.pit_id; usedPits.add(pit); }
  }
  const closed = trace.at(-1);
  assert.equal(closed.request.method, 'DELETE'); assert.equal(closed.route, '_search/point_in_time');
  assert.deepEqual(new Set(closed.request.body.pit_id), usedPits);
  assert.ok([...usedPits].every(id => closed.response?.body.pits?.some(entry => entry.pit_id === id && entry.successful)));
  const ids = final.response.body.hits.hits.map(hit => hit.fields?.id?.[0] ?? hit._id);
  assert.deepEqual(ids, result.hits.map(hit => hit.id));
  return { bounds, finalBody: body, orFilters, stageCount: trace.length,
    finalServiceHitIds: ids, positiveThresholdApplied: bounds.threshold > 0 };
}

export async function countMaximaCandidates(index, inspection, totalEligible, returned, { request = api } = {}) {
  const trace = [];
  const count = async filters => {
    const body = { query: { bool: { filter: filters } } }, route = index + '/_count';
    const row = { route, request: { method: 'POST', body } }; trace.push(row);
    let response;
    try { response = await request(route, { method: 'POST', body, timeoutMs: 10000 }); row.response = response; }
    catch (error) { row.error = String(error.stack ?? error); throw error; }
    assert.ok(!response.body._shards?.failed, 'Partial candidate count.');
    assert.ok(Number.isInteger(response.body.count) && response.body.count >= 0); return response.body.count;
  };
  try {
    const orEligible = inspection.positiveThresholdApplied ? await count(inspection.orFilters) : totalEligible;
    const finalEligible = inspection.bounds.maximaBounds.addedRanges > 0 ? await count(inspection.finalBody.query.bool.filter) : orEligible;
    assert.ok(totalEligible >= orEligible && orEligible >= finalEligible && finalEligible >= returned, 'Invalid pruning counts.');
    return { totalEligible, orEligible, finalEligible, originalPruned: totalEligible - orEligible,
      additionallyPruned: orEligible - finalEligible, totalPruned: totalEligible - finalEligible, trace };
  } catch (error) { error.countTrace = trace; throw error; }
}

async function captureIndex(index, request) {
  const [count, mapping, settings, stats] = await Promise.all([request(index + '/_count'), request(index + '/_mapping'), request(index + '/_settings'), request(index + '/_stats/docs,indexing')]);
  const indexSettings = settings.body[index]?.settings?.index, primary = stats.body.indices?.[index]?.primaries;
  assert.ok(indexSettings?.uuid && primary?.indexing); assert.ok(!count.body._shards?.failed);
  const snapshot = { index, count: count.body.count, uuid: indexSettings.uuid, mapping: mapping.body[index]?.mappings, settings: indexSettings, stats: stats.body };
  snapshot.generation = { count: snapshot.count, uuid: snapshot.uuid, mappingHash: hash(snapshot.mapping), settingsHash: hash(indexSettings),
    docs: primary.docs, indexingTotal: primary.indexing.index_total, deleteTotal: primary.indexing.delete_total };
  return snapshot;
}

export async function runFavoriteMaximaFidelity({ directory, index = 'color-exploration-favorite-points-real-v2' }, { request = api } = {}) {
  const config = maximaFidelityConfiguration(['--directory', directory, '--index', index]);
  assert.equal(BASE, 'http://127.0.0.1:19216');
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  const save = (name, value) => writeFile(path.join(config.directory, name), JSON.stringify(value, null, 2), { flag: 'wx' });
  const append = (name, value) => appendFile(path.join(config.directory, name), JSON.stringify(value) + '\n');
  const result = { schemaVersion: 1, experiment: 'favorite-maxima-fidelity', methods: [method], configuration: config, startedAt: new Date().toISOString(),
    rows: [], references: [], positiveBoundExecutions: 0, maximaRangeExecutions: 0, additionallyPrunedExecutions: 0,
    limitations: ['Execution fidelity against the preserved numeric objective on545 retained assets, not a human-relevance or capacity measurement.',
      'Known duplicate-target arithmetic loss remains in the parent objective; duplicate cases verify conservative fallback, not its correction.',
      'Candidate counts are measured after PIT closure; unchanged before/after index generations are required.',
      'Every reference uses keyword ID doc values and stored_fields:_none_; full rankings are retrieved only for offline validation.'] };
  try {
    const sources = await favoriteSourceSnapshot(import.meta.url); result.sourceSnapshotHash = hash(sources); await save('source-snapshot.json', sources);
    const verified = await loadFavoriteScaleInputs({ scope: 'full', bucketCount: 256 }), documents = await loadHueDocuments(256);
    const ids = documents.map(doc => doc.id).sort(); assert.equal(ids.length, 545); assert.equal(new Set(ids).size, 545);
    result.sourceIdentityHash = verified.identityHash; result.documentsHash = hash(documents);
    const before = await captureIndex(index, request), plan = createFavoriteUtilityPlan({ presets: controls() });
    assertExecutionIndex(before, { sourceIdentityHash: verified.identityHash, documentsHash: result.documentsHash, plan, allPresets: true });
    assert.equal(before.mapping.properties.id?.type, 'keyword'); assert.notEqual(before.mapping.properties.id.doc_values, false);
    result.before = before; await save('index-before.json', before);
    const jobs = maximaFidelityJobs(documents); result.expectedQueryPresetCombinations = 144;
    result.expectedExecutions = jobs.reduce((sum, job) => sum + job.limits.length, 0); await save('jobs.json', jobs);
    for (const job of jobs) {
      const options = { query: job.query, parameters: job.parameters, eligibleIds: job.eligibleIds, excludedIds: job.excludedIds, filter: job.filter };
      const referenceTrace = [];
      let reference;
      try {
        reference = await searchFavoriteDocvalueUtilities({ ...options, index, limit: 1000, timeoutMs: 10000 }, { request: async (route, settings) => {
          const row = { route, request: { method: settings.method, body: settings.body } }; referenceTrace.push(row);
          try { const response = await request(route, settings); row.response = response; return response; }
          catch (error) { row.error = String(error.stack ?? error); throw error; }
        } });
      } catch (error) { error.referenceTrace = referenceTrace; throw error; }
      if (job.completeCorpus) assert.deepEqual(reference.hits.map(hit => hit.id).sort(), ids);
      if (job.id === 'empty-eligibility') assert.equal(reference.hits.length, 0);
      if (job.zeroScores) { assert.ok(reference.hits.length >= 2); assert.ok(reference.hits.every(hit => hit.score === 0)); assert.deepEqual(reference.hits.map(hit => hit.id), reference.hits.map(hit => hit.id).sort()); }
      await append('references.jsonl', { queryId: job.id, options, body: buildFavoriteDocvalueQuery({ ...options, limit: 1000 }), reference, trace: referenceTrace });
      result.references.push({ queryId: job.id, parameters: job.parameters, count: reference.hits.length, duplicateDiagnostic: Boolean(job.duplicateDiagnostic), zeroScores: Boolean(job.zeroScores) });
      for (const limit of job.limits) {
        const captured = await captureMaximaExecution({ ...options, index, limit, timeoutMs: 10000 }, { request });
        await append('service-traces.jsonl', { queryId: job.id, parameters: job.parameters, method, limit, ...captured });
        const comparison = assertSameExecutionRanking(reference.hits.slice(0, limit), captured.result.hits, { exactScores: true });
        const inspected = inspectMaximaExecution(captured.result, captured.trace, buildFavoriteUtilityQuery({ ...options, limit }));
        const counts = await countMaximaCandidates(index, inspected, reference.hits.length, captured.result.hits.length, { request });
        await append('candidate-counts.jsonl', { queryId: job.id, parameters: job.parameters, method, limit, ...counts });
        const { trace, ...pruning } = counts;
        const row = { queryId: job.id, parameters: job.parameters, method, limit, ...comparison, pruning, evidence: captured.result.evidence };
        result.rows.push(row);
        if (inspected.positiveThresholdApplied) result.positiveBoundExecutions++;
        if (inspected.bounds.maximaBounds.addedRanges) result.maximaRangeExecutions++;
        if (pruning.additionallyPruned) result.additionallyPrunedExecutions++;
      }
      await append('progress.jsonl', { at: new Date().toISOString(), queryId: job.id, completedReferences: result.references.length, completedExecutions: result.rows.length });
    }
    result.after = await captureIndex(index, request); await save('index-after.json', result.after);
    assert.deepEqual(result.after.generation, result.before.generation, 'Index generation changed during fidelity.');
    assert.equal(hash(await favoriteSourceSnapshot(import.meta.url)), result.sourceSnapshotHash, 'Source graph changed.');
    assert.equal(result.rows.length, result.expectedExecutions); assert.equal(result.references.length, jobs.length);
    result.finishedAt = new Date().toISOString(); result.passed = true; await save('fidelity.json', result); return result;
  } catch (error) {
    result.error = String(error.stack ?? error); result.interruptedAt = new Date().toISOString();
    if (error.executionTrace) await save('failure-trace.json', error.executionTrace);
    if (error.referenceTrace) await save('failure-reference-trace.json', error.referenceTrace);
    if (error.countTrace) await save('failure-count-trace.json', error.countTrace);
    await save('failure.json', result); throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runFavoriteMaximaFidelity(maximaFidelityConfiguration(process.argv.slice(2)));
  console.log(JSON.stringify({ directory: result.configuration.directory, comparisons: result.rows.length, additionallyPrunedExecutions: result.additionallyPrunedExecutions, passed: result.passed }));
}
