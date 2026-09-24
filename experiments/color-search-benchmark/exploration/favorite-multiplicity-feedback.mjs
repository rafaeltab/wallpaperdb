// Accuracy-only use of the existing human-feedback dataset and metrics. There
// are no warmups, repeated performance searches, latency summaries or new labels.
import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset } from '../evaluation/loop/dataset.mjs';
import { searchQuery, EXPERIMENT_ROOT } from '../evaluation/loop/runner.mjs';
import { evaluateRanking, summarizeAccuracy, accuracyPolicy } from '../evaluation/loop/metrics.mjs';
import { createCandidate as createParent } from './favorite-docvalue-adapter.mjs';
import { createCandidate as createCorrected } from './favorite-multiplicity-adapter.mjs';
import { FAVORITE_PARAMETERS } from './favorite-scale-corpus.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { multiplicityFidelityConfiguration } from './favorite-multiplicity-fidelity.mjs';
import { api, BASE, hash, loadExpandedCorpus } from './service.mjs';
export function multiplicityFeedbackRequest(c) {
  const eligibleIds = c.rankingCondition && c.conditionalEligibility?.length ? c.expectedRankedIds : c.eligibleIds;
  return structuredClone({ id: c.id, query: searchQuery(c.query), inputKind: c.inputKind,
    ...(eligibleIds ? { eligibleIds } : {}), ...(c.excludedIds ? { excludedIds: c.excludedIds } : {}) });
}
export async function evaluateMultiplicityFeedback(candidate, dataset, corpus, { capture = async () => {} } = {}) {
  const available = new Set(corpus.map(row => row.id)), rows = [];
  for (const c of dataset.cases) {
    const row = { caseId: c.id, category: c.category, inputKind: c.inputKind, status: 'unsupported', accuracy: evaluateRanking(c, []), hits: [] };
    rows.push(row);
    if (c.inputKind === 'conceptual') { row.reason = c.unsupportedReason ?? 'Conceptual case'; continue; }
    const missing = (c.expectedRankedIds ?? c.judgedIds ?? []).filter(id => !available.has(id));
    if (missing.length) { row.reason = 'Corpus lacks judged images: ' + missing.join(', '); continue; }
    try {
      const caseData = multiplicityFeedbackRequest(c), support = await candidate.supports(caseData);
      if (!support.supported) { row.reason = support.reason; continue; }
      const result = await candidate.search({ caseData, limit: 1000, signal: AbortSignal.timeout(10000) });
      let previous = Infinity; const seen = new Set();
      for (const hit of result.hits) { assert.ok(available.has(hit.id) && !seen.has(hit.id) && Number.isFinite(hit.score) && hit.score <= previous); seen.add(hit.id); previous = hit.score; }
      row.status = 'ok'; row.hits = result.hits; row.accuracy = evaluateRanking(c, result.hits); row.evidence = result.evidence;
    } catch (error) { row.status = 'error'; row.reason = String(error.stack ?? error); }
    await capture(row);
  }
  return rows;
}
export async function runFavoriteMultiplicityFeedback({ directory, index }) {
  const configuration = multiplicityFidelityConfiguration(['--directory', directory, ...(index ? ['--index', index] : [])]); index = configuration.index;
  assert.equal(BASE, 'http://127.0.0.1:19216');
  await mkdir(path.dirname(configuration.directory), { recursive: true }); await mkdir(configuration.directory);
  const save = (name, value) => writeFile(path.join(configuration.directory, name), JSON.stringify(value, null, 2), { flag: 'wx' });
  const append = (name, value) => appendFile(path.join(configuration.directory, name), JSON.stringify(value) + '\n');
  const sources = await favoriteSourceSnapshot(import.meta.url), dataset = await loadDataset({ root: EXPERIMENT_ROOT, extraImageFiles: ['evaluation/perceived-red-pagoda-001.json'] }), corpus = await loadExpandedCorpus();
  await save('source-snapshot.json', sources); await save('dataset.json', { ...dataset, accuracyPolicy }); await save('corpus.json', corpus);
  const generation = async () => (await api(index + '/_stats/docs,indexing?filter_path=indices.*.uuid,indices.*.primaries.docs,indices.*.primaries.indexing.index_total,indices.*.primaries.indexing.delete_total')).body;
  const before = await generation(); await save('index-before.json', before);
  const result = { schemaVersion: 1, experiment: 'favorite-multiplicity-feedback', configuration, startedAt: new Date().toISOString(), datasetHash: hash(dataset), sourceSnapshotHash: hash(sources), candidates: [],
    limitations: ['Development human judgments with existing uncertainty and sparsity; no new human labels or holdout claims.', 'Accuracy-only. No performance search phase or capacity/latency statistics.', 'Ordinary queries are expected to retain parent rankings; duplicate arithmetic correction is validated separately by service fidelity.'] };
  try {
    for (const [id, create] of [['favorite-utility-numeric-docvalues', createParent], ['favorite-utility-numeric-multiplicity', createCorrected]]) {
      const candidate = await create({ config: { id, index, parameters: { ...FAVORITE_PARAMETERS, bucketCount: 256 } }, context: { corpus, experimentRoot: EXPERIMENT_ROOT } }, {
        request: async (route, options) => {
          const response = await api(route, options);
          // Retain raw service correctness evidence, excluding transport timing.
          const { took, ...body } = response.body;
          await append('service-traces.jsonl', { candidate: id, route, request: { method: options.method, body: options.body }, response: body }); return response;
        },
      });
      const prepared = await candidate.prepare();
      const cases = await evaluateMultiplicityFeedback(candidate, dataset, corpus, { capture: row => append('cases.jsonl', { candidate: id, ...row }) });
      result.candidates.push({ id, metadata: candidate.metadata, prepared, cases, accuracy: summarizeAccuracy(cases),
        coverage: { ok: cases.filter(row => row.status === 'ok').length, unsupported: cases.filter(row => row.status === 'unsupported').length, errors: cases.filter(row => row.status === 'error').length } });
    }
    const [parent, corrected] = result.candidates;
    assert.equal(parent.coverage.errors, 0); assert.equal(corrected.coverage.errors, 0);
    assert.deepEqual(corrected.cases.map(row => [row.caseId, row.status, row.hits]), parent.cases.map(row => [row.caseId, row.status, row.hits]), 'Existing feedback rankings changed.');
    assert.deepEqual(corrected.accuracy, parent.accuracy);
    const after = await generation(); await save('index-after.json', after); assert.deepEqual(after, before);
    assert.equal(hash(await favoriteSourceSnapshot(import.meta.url)), result.sourceSnapshotHash);
    result.passed = true; result.finishedAt = new Date().toISOString(); await save('feedback.json', result); return result;
  } catch (error) { result.error = String(error.stack ?? error); await save('failure.json', result); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runFavoriteMultiplicityFeedback(multiplicityFidelityConfiguration(process.argv.slice(2)));
  console.log(JSON.stringify({ passed: result.passed, candidates: result.candidates.map(({ id, coverage }) => ({ id, ...coverage })), directory: result.configuration.directory }));
}
