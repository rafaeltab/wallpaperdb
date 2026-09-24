// Correctness-only experiment. The application computes an offline oracle for
// verification; every prototype result is filtered and globally ranked by OpenSearch.
import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAVORITE_PARAMETERS, loadFavoriteScaleInputs } from './favorite-scale-corpus.mjs';
import { loadHueDocuments } from './hue-index.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { createFavoriteUtilityPlan } from './favorite-utilities.mjs';
import { FIDELITY_QUERIES } from './favorite-optimization-fidelity.mjs';
import { assertExecutionIndex } from './favorite-execution-fidelity.mjs';
import { buildFavoriteDocvalueQuery, searchFavoriteDocvalueUtilities } from './favorite-docvalue-fetch.mjs';
import { buildFavoriteMultiplicityQuery, groupFavoriteUtilityTerms, searchFavoriteMultiplicity } from './favorite-multiplicity-utilities.mjs';
import { api, BASE, hash, safeIndexName } from './service.mjs';
const repository = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const method = 'favorite-utility-numeric-multiplicity';
const presets = () => [0, .5, 1].flatMap(qualityInfluence => [0, 1, 3].map(cutoffBlendExponent => ({ ...FAVORITE_PARAMETERS, bucketCount: 256, qualityInfluence, cutoffBlendExponent })));
export function multiplicityFidelityConfiguration(args = []) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    assert.ok(['--index', '--directory'].includes(key) && value && !value.startsWith('--') && !Object.hasOwn(values, key)); values[key] = value;
  }
  assert.ok(values['--directory'], 'Provide a new external directory.');
  const directory = path.resolve(values['--directory']);
  assert.ok(directory !== path.parse(directory).root && directory !== repository && !directory.startsWith(repository + path.sep));
  return { directory, index: safeIndexName(values['--index'] ?? 'color-exploration-favorite-points-real-v2') };
}
export function multiplicityCases() {
  const red = percent => ({ color: '#ff0000', percent }), near = percent => ({ color: '#fe0000', percent }), blue = percent => ({ color: '#0000ff', percent });
  return [
    { id: 'red-red', targets: [red(50), red(50)], expectedGroups: 1, single: red(50) },
    { id: 'red-nearby-red', targets: [red(50), near(50)], expectedGroups: 1, single: red(50) },
    { id: 'red-red-blue', targets: [red(20), red(20), blue(20)], expectedGroups: 2 },
    { id: 'red-nearby-red-blue', targets: [red(20), near(20), blue(20)], expectedGroups: 2 },
    { id: 'red-different-amounts', targets: [red(20), near(40)], expectedGroups: 2, unchanged: true },
    { id: 'red-red-vibe', targets: [{ color: '#ff0000' }, { color: '#fe0000' }], expectedGroups: 1, mode: 'vibe', single: { color: '#ff0000' } },
  ].map(({ targets, mode = 'proportions', ...row }) => ({ ...row, query: { mode, targets } }));
}
export function readMultiplicityValues(body, { ids, fields }) {
  assert.ok(!body.timed_out && !body._shards?.failed, 'Partial doc-value response.');
  assert.equal(body.hits.total.relation, 'eq'); assert.equal(body.hits.total.value, ids.length);
  assert.equal(body.hits.hits.length, ids.length);
  const result = body.hits.hits.map(hit => {
    assert.equal(hit.fields?.id?.length, 1); const id = hit.fields.id[0]; assert.equal(typeof id, 'string');
    if (hit._id !== undefined) assert.equal(hit._id, id);
    const values = Object.fromEntries(fields.map(field => {
      const value = hit.fields[field]; assert.equal(value?.length, 1, 'Missing or ambiguous utility: ' + field);
      assert.ok(Number.isFinite(value[0]) && value[0] >= 0 && value[0] <= 1); return [field, Math.fround(value[0])];
    }));
    return { id, values };
  });
  assert.deepEqual(result.map(row => row.id).sort(), [...ids].sort()); return result;
}
export function multiplicityOracle(parentBody, documents) {
  // Independent derivation from original requests, without the query rewriter.
  const requestedFields = parentBody.query.bool.should.map(term => term.function_score.field_value_factor.field), count = requestedFields.length;
  const multiplicities = new Map();
  for (const field of requestedFields) multiplicities.set(field, (multiplicities.get(field) ?? 0) + 1);
  let maxIdealMeanError = 0;
  const hits = documents.map(({ id, values }) => {
    for (const field of requestedFields) assert.ok(Number.isFinite(values[field]), 'Missing oracle field: ' + field);
    // Native FieldValueFactor stores factor as float, reads float doc values as
    // double, then its scorer casts each function result to float before summing.
    const score = Math.fround([...multiplicities].reduce((sum, [field, occurrences]) => sum + Math.fround(Math.fround(values[field]) * Math.fround(occurrences / count)), 0));
    const ideal = requestedFields.reduce((sum, field) => sum + Math.fround(values[field]), 0) / count;
    maxIdealMeanError = Math.max(maxIdealMeanError, Math.abs(score - ideal));
    return { id, score };
  }).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  assert.ok(maxIdealMeanError <= 3e-7, 'Grouped float32 score diverges from the intended repeated-term mean.');
  return { hits, maxIdealMeanError };
}
export function assertMultiplicityRanking(expected, actual) {
  assert.equal(actual.length, expected.length, 'Wrong hit count.');
  for (let i = 0; i < expected.length; i++) {
    assert.equal(actual[i].id, expected[i].id, 'Global order differs at rank ' + (i + 1));
    assert.equal(Math.fround(actual[i].score), Math.fround(expected[i].score), 'Float32 score differs for ' + expected[i].id);
  }
  return { count: actual.length, exactFloat32Scores: true, exactIdsAndOrder: true };
}
async function captureIndex(index, request) {
  const [count, mapping, settings, stats] = await Promise.all([request(index + '/_count'), request(index + '/_mapping'), request(index + '/_settings'), request(index + '/_stats/docs,indexing')]);
  const indexSettings = settings.body[index]?.settings?.index, primary = stats.body.indices?.[index]?.primaries;
  assert.ok(indexSettings?.uuid && primary?.indexing); assert.ok(!count.body._shards?.failed);
  const snapshot = { index, count: count.body.count, uuid: indexSettings.uuid, mapping: mapping.body[index]?.mappings, settings: indexSettings, stats: stats.body };
  snapshot.generation = { count: snapshot.count, uuid: snapshot.uuid, mappingHash: hash(snapshot.mapping), settingsHash: hash(indexSettings), docs: primary.docs, indexingTotal: primary.indexing.index_total, deleteTotal: primary.indexing.delete_total };
  return snapshot;
}
export async function runFavoriteMultiplicityFidelity({ directory, index }, { request = api } = {}) {
  const config = multiplicityFidelityConfiguration(['--directory', directory, ...(index ? ['--index', index] : [])]); index = config.index;
  assert.equal(BASE, 'http://127.0.0.1:19216');
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  const save = (name, value) => writeFile(path.join(config.directory, name), JSON.stringify(value, null, 2), { flag: 'wx' });
  const append = (name, value) => appendFile(path.join(config.directory, name), JSON.stringify(value) + '\n');
  let context = { phase: 'preflight' };
  const captured = async (route, options = {}) => {
    const row = { context, route, request: { method: options.method ?? 'GET', body: options.body } };
    try { const response = await request(route, options); row.response = response; await append('service-traces.jsonl', row); return response; }
    catch (error) { row.error = String(error.stack ?? error); await append('service-traces.jsonl', row); throw error; }
  };
  const result = { schemaVersion: 1, experiment: 'favorite-utility-multiplicity-fidelity', method, configuration: config, startedAt: new Date().toISOString(), rows: [], distinctParentComparisons: 0, correctedExecutions: 0,
    limitations: ['Correctness only on545 assets while scale indexing may be running; no latency or capacity conclusions.', 'Offline oracle alone reads complete rankings; product execution is one complete OpenSearch query with no application reranking.', 'Restores repeated target weights. It does not add percentages together or define palette allocation semantics.', 'Grouped float32 arithmetic can differ from an ideal unrounded mean; exact native stored-utility scores are checked. Original16 methods stay unchanged.'] };
  try {
    const source = await favoriteSourceSnapshot(import.meta.url); result.sourceSnapshotHash = hash(source); await save('source-snapshot.json', source);
    const verified = await loadFavoriteScaleInputs({ scope: 'full', bucketCount: 256 }), documents = await loadHueDocuments(256), ids = documents.map(doc => doc.id).sort();
    assert.equal(ids.length, 545); assert.equal(new Set(ids).size, 545);
    const plan = createFavoriteUtilityPlan({ presets: presets() });
    result.before = await captureIndex(index, captured); await save('index-before.json', result.before);
    assertExecutionIndex(result.before, { sourceIdentityHash: verified.identityHash, documentsHash: hash(documents), plan });
    assert.equal(result.before.mapping.properties.id.type, 'keyword'); assert.notEqual(result.before.mapping.properties.id.doc_values, false);
    for (const parameters of presets()) {
      const cases = multiplicityCases(); context = { phase: 'doc-values', parameters };
      const fields = [...new Set(cases.flatMap(row => buildFavoriteDocvalueQuery({ query: row.query, parameters }).query.bool.should.map(term => term.function_score.field_value_factor.field)))];
      assert.ok(fields.length < 80);
      const docvalueBody = { size: 1000, _source: false, stored_fields: '_none_', docvalue_fields: ['id', ...fields], track_total_hits: true, query: { match_all: {} }, sort: [{ id: 'asc' }] };
      const values = readMultiplicityValues((await captured(index + '/_search?request_cache=false', { method: 'POST', body: docvalueBody, timeoutMs: 10000 })).body, { ids, fields });
      for (const row of cases) {
        const options = { query: row.query, parameters }, parent = buildFavoriteDocvalueQuery(options), groups = groupFavoriteUtilityTerms(parent);
        assert.equal(groups.evidence.distinctUtilityCount, row.expectedGroups); assert.equal(groups.evidence.corrected, !row.unchanged);
        const oracle = multiplicityOracle(parent, values); await append('oracles.jsonl', { queryId: row.id, parameters, ...oracle, groups: groups.evidence });
        for (const limit of [1000, 20, 1]) {
          context = { phase: 'corrected', queryId: row.id, parameters, limit };
          const actual = await searchFavoriteMultiplicity({ ...options, method, index, limit }, { request: captured });
          const comparison = assertMultiplicityRanking(oracle.hits.slice(0, limit), actual.hits);
          result.rows.push({ ...context, ...comparison, evidence: actual.evidence, maxIdealMeanError: oracle.maxIdealMeanError }); result.correctedExecutions++;
        }
        if (row.single || row.unchanged) {
          context = { phase: row.single ? 'single-equivalent' : 'unchanged-parent', queryId: row.id, parameters };
          const query = row.single ? { mode: row.query.mode, targets: [row.single] } : row.query;
          const parentResult = await searchFavoriteDocvalueUtilities({ index, parameters, query, limit: 1000 }, { request: captured });
          assertMultiplicityRanking(oracle.hits, parentResult.hits);
          if (row.unchanged) assert.deepEqual(buildFavoriteMultiplicityQuery(options), parent);
        }
      }
      // Original named/precise/multicolor controls keep the exact query and results.
      for (const row of FIDELITY_QUERIES) {
        const options = { query: row.query, parameters, index, limit: 1000 };
        assert.deepEqual(buildFavoriteMultiplicityQuery(options), buildFavoriteDocvalueQuery(options));
        context = { phase: 'distinct-parent', queryId: row.id, parameters };
        const parent = await searchFavoriteDocvalueUtilities(options, { request: captured });
        const actual = await searchFavoriteMultiplicity({ ...options, method }, { request: captured });
        assert.deepEqual(actual.hits, parent.hits); assert.deepEqual(actual.hits.map(hit => hit.id).sort(), ids);
        result.distinctParentComparisons++;
      }
      await append('progress.jsonl', { at: new Date().toISOString(), correctedExecutions: result.correctedExecutions, distinctParentComparisons: result.distinctParentComparisons, parameters });
    }
    // Explicit filters, empty eligibility and all-zero ties remain service-global.
    const parameters = presets()[4], row = multiplicityCases()[0], query = row.query;
    for (const eligibility of [{ eligibleIds: [] }, { eligibleIds: ids.slice(0, 7), excludedIds: [ids[0]] }, { excludedIds: ids.slice(0, 20) }]) {
      context = { phase: 'filtered-duplicates', eligibility };
      const actual = await searchFavoriteMultiplicity({ index, method, query, parameters, ...eligibility, limit: 1000 }, { request: captured });
      const parent = await searchFavoriteDocvalueUtilities({ index, query: { mode: query.mode, targets: [row.single] }, parameters, ...eligibility, limit: 1000 }, { request: captured });
      assert.deepEqual(actual.hits, parent.hits); result.rows.push({ ...context, count: actual.hits.length, exactIdsAndScores: true });
    }
    context = { phase: 'postflight' }; result.after = await captureIndex(index, captured); await save('index-after.json', result.after);
    assert.deepEqual(result.after.generation, result.before.generation); assert.equal(hash(await favoriteSourceSnapshot(import.meta.url)), result.sourceSnapshotHash);
    assert.equal(result.correctedExecutions, 162); assert.equal(result.distinctParentComparisons, 144);
    result.passed = true; result.finishedAt = new Date().toISOString(); await save('fidelity.json', result); return result;
  } catch (error) { result.error = String(error.stack ?? error); result.failedContext = context; await save('failure.json', result); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runFavoriteMultiplicityFidelity(multiplicityFidelityConfiguration(process.argv.slice(2)));
  console.log(JSON.stringify({ passed: result.passed, correctedExecutions: result.correctedExecutions, distinctParentComparisons: result.distinctParentComparisons, directory: result.configuration.directory }));
}
