// Offline correctness probe only. Runtime wallpaper order always comes from OpenSearch.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BASE, INDEX, STORE, loadFeatures, searchIndex } from './service.mjs';
import { interpretQuery } from './query.mjs';
import { NATIVE_REFINED_METHODS, buildNativeRefinedQuery, nativeRefinedParameters } from './methods-native-refined.mjs';

if (new URL(BASE).port !== '19216') throw Error('This probe is restricted to the small real-corpus service on port 19216.');

// Independent algebraic oracle, used solely to assert returned service scores.
function reference(feature, compiled, parameters) {
  let score = 0;
  for (const target of compiled.targets) {
    const area = feature[`cov_${target.name}`] / 10000;
    const quality = Math.fround(feature[`quality_${target.name}`]);
    if (compiled.mode === 'vibe') score += area ** parameters.areaPower * quality;
    else {
      const delta = area - Math.round(target.amount * 10000) / 10000;
      const fitness = Math.max(0, 1 - Math.abs(delta) * (delta > 0 ? parameters.excessPenalty : 1));
      const qualityFactor = target.amount === 0 ? 1 : 1 - parameters.qualityPenalty * (1 - quality);
      score += fitness * qualityFactor;
    }
  }
  return score / compiled.targets.length;
}

const queries = [
  { label: 'red vibe', query: { text: 'red' } },
  { label: 'grayscale vibe', query: { text: 'grayscale' } },
  { label: 'dark vibe', query: { text: 'dark' } },
  { label: 'red and green vibe', query: { mode: 'vibe', targets: [{ name: 'red' }, { name: 'green' }] } },
  { label: '40% green, rest free', query: { mode: 'proportions', targets: [{ name: 'green', percent: 40 }] } },
  { label: '50% red, 50% green', query: { mode: 'proportions', targets: [{ name: 'red', percent: 50 }, { name: 'green', percent: 50 }] } },
  { label: '80% grayscale, 20% red', query: { mode: 'proportions', targets: [{ name: 'grayscale', percent: 80 }, { name: 'red', percent: 20 }] } },
  { label: '80% grayscale, 10% red, rest free', query: { mode: 'proportions', targets: [{ name: 'grayscale', percent: 80 }, { name: 'red', percent: 10 }] } },
  { label: '0% red, 40% green', query: { mode: 'proportions', targets: [{ name: 'red', percent: 0 }, { name: 'green', percent: 40 }] } },
];
const features = await loadFeatures();
assert.ok(features.length >= 545, 'The full corpus must be present.');
const byId = new Map(features.map(feature => [feature.id, feature]));
const checks = [];
for (const method of NATIVE_REFINED_METHODS) {
  const parameters = nativeRefinedParameters(method);
  for (const { label, query } of queries) {
    const compiled = interpretQuery(query);
    const request = buildNativeRefinedQuery({ method, query, limit: features.length });
    assert.ok(!JSON.stringify(request).includes('script'));
    const result = await searchIndex(INDEX, request);
    assert.equal(result.hits.length, features.length, `${method.id}: ${label}: every corpus record has required features`);
    let maximumError = 0, previousReference = Infinity;
    for (const hit of result.hits) {
      const expected = reference(byId.get(hit.id), compiled, parameters);
      const error = Math.abs(hit.score - expected);
      maximumError = Math.max(maximumError, error);
      assert.ok(error < 1e-6, `${method.id}: ${label}: ${hit.id} actual ${hit.score} expected ${expected}`);
      assert.ok(expected <= previousReference + 1e-6, 'Service order differs from objective');
      previousReference = expected;
    }
    checks.push({ method: method.id, label, count: result.hits.length, maximumError, evidence: result.evidence, firstFive: result.hits.slice(0, 5) });
  }
}
const selectedIds = features.slice(0, 4).map(feature => feature.id);
const filtered = await searchIndex(INDEX, buildNativeRefinedQuery({ method: 'native-quality-asymmetric', query: queries[0].query,
  limit: 10, eligibleIds: selectedIds, excludedIds: selectedIds.slice(0, 1), filter: { term: { id: selectedIds[1] } } }));
assert.deepEqual(filtered.hits.map(hit => hit.id), [selectedIds[1]]);

const green = interpretQuery(queries[4].query);
const asymmetric = nativeRefinedParameters('native-quality-asymmetric');
const symmetric = nativeRefinedParameters('native-quality-linear');
const sample = (area, quality = 1) => ({ cov_green: area * 10000, quality_green: quality });
const semanticChecks = {
  ideal40: reference(sample(0.4), green, asymmetric),
  short20: reference(sample(0.2), green, asymmetric),
  excess60: reference(sample(0.6), green, asymmetric),
  excessive80: reference(sample(0.8), green, asymmetric),
  dulled40: reference(sample(0.4, 0.3), green, asymmetric),
};
assert.ok(semanticChecks.ideal40 > semanticChecks.short20);
assert.ok(semanticChecks.short20 > semanticChecks.excess60);
assert.ok(semanticChecks.excess60 > semanticChecks.excessive80);
assert.ok(semanticChecks.ideal40 > semanticChecks.dulled40);
assert.ok(Math.abs(reference(sample(0.2), green, symmetric) - reference(sample(0.6), green, symmetric)) < 1e-9);

const receipt = { schemaVersion: 1, createdAt: new Date().toISOString(), service: BASE, index: INDEX, corpusCount: features.length,
  checks, semanticChecks, filteredIds: filtered.hits.map(hit => hit.id),
  note: 'Native-function correctness assertions only. Synthetic algebra checks are not human labels; live timings are not controlled scalability measurements.' };
const directory = path.join(STORE, 'native-refined-probes');
await mkdir(directory, { recursive: true });
const filename = path.join(directory, `${receipt.createdAt.replaceAll(':', '-')}.json`);
await writeFile(filename, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ receipt: filename, methods: NATIVE_REFINED_METHODS.map(method => method.id), scoreChecks: checks.reduce((sum, check) => sum + check.count, 0),
  maximumScoreError: Math.max(...checks.map(check => check.maximumError)), semanticChecks }, null, 2));
