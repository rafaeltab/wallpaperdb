// Offline validation of service rankings; never part of the user search path.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAVORITE_METHOD, FAVORITE_PARAMETERS, FAVORITE_WORKLOAD, loadFavoriteScaleInputs } from './favorite-scale-corpus.mjs';
import { loadHueDocuments } from './hue-index.mjs';
import { buildCutoffQuery } from './methods-cutoff.mjs';
import { buildFavoriteOptimizedQuery } from './favorite-optimized-scoring.mjs';
import { FAVORITE_UTILITY_METHODS, buildFavoriteUtilityQuery, favoriteUtilityReference, createFavoriteUtilityPlan, toFavoriteUtilityDocument, quantizeRankFeature } from './favorite-utilities.mjs';
import { api, validateSearchResponse, hash } from './service.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';

// Fetch the indexed ID from doc values. Reading stored _id can decompress the
// same large stored block as this experiment's multi-megabyte debug _source.
// Query scores and global ordering are untouched; this is validation decoding.
async function searchIndex(index, body) {
  const response = await api(index + '/_search?request_cache=false', { method: 'POST',
    body: { ...body, stored_fields: '_none_', docvalue_fields: ['id'] }, timeoutMs: 10000 });
  for (const hit of response.body.hits?.hits ?? []) {
    assert.equal(hit.fields?.id?.length, 1, 'Expected one indexed document ID');
    hit._id = hit.fields.id[0];
  }
  return { hits: validateSearchResponse(response.body) };
}

export const FIDELITY_QUERIES = [
  ...FAVORITE_WORKLOAD.filter(item => item.selectivity === 'all'),
  ...['#0077ff', '#ff99cc', '#ffffff', '#000000', '#804030'].map(color => ({ id: 'vibe-' + color.slice(1), query: { mode: 'vibe', targets: [{ color }] } })),
  ...['dark', 'grayscale', 'bright'].map(name => ({ id: 'vibe-' + name, query: { mode: 'vibe', targets: [{ name }] } })),
  { id: 'grayscale80-red20', query: { mode: 'proportions', targets: [{ name: 'grayscale', percent: 80 }, { color: '#ff0000', percent: 20 }] } },
  { id: 'grayscale80-red10', query: { mode: 'proportions', targets: [{ name: 'grayscale', percent: 80 }, { color: '#ff0000', percent: 10 }] } },
  { id: 'zero-blue', query: { mode: 'proportions', targets: [{ color: '#0000ff', percent: 0 }, { color: '#ff0000', percent: 50 }] } },
  { id: 'red95', query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 95 }] } },
];
export function compareFavoriteRankings(reference, actual) {
  assert.equal(actual.length, reference.length);
  assert.equal(new Set(actual.map(hit => hit.id)).size, actual.length);
  const byId = new Map(reference.map((hit, rank) => [hit.id, { ...hit, rank }]));
  const position = new Map(actual.map((hit, rank) => [hit.id, rank]));
  assert.deepEqual([...position.keys()].sort(), [...byId.keys()].sort());
  const deltas = actual.map(hit => Math.abs(hit.score - byId.get(hit.id).score));
  let inversions = 0, meaningfulInversions = 0, largestInversionScoreGap = 0;
  for (let a = 0; a < reference.length; a++) for (let b = a + 1; b < reference.length; b++) {
    if (position.get(reference[a].id) > position.get(reference[b].id)) {
      inversions++;
      const gap = reference[a].score - reference[b].score;
      if (gap > 1e-6) meaningfulInversions++;
      largestInversionScoreGap = Math.max(largestInversionScoreGap, gap);
    }
  }
  const top20 = new Set(reference.slice(0, 20).map(hit => hit.id));
  return { count: actual.length, identicalIds: actual.every((hit, rank) => hit.id === reference[rank].id),
    identicalScores: actual.every(hit => hit.score === byId.get(hit.id).score),
    maximumScoreError: Math.max(0, ...deltas), meanScoreError: deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length),
    top20Overlap: actual.slice(0, 20).filter(hit => top20.has(hit.id)).length,
    maxRankChange: Math.max(0, ...actual.map((hit, rank) => Math.abs(rank - byId.get(hit.id).rank))),
    inversions, meaningfulInversions, meaningfulGapThreshold: 1e-6, largestInversionScoreGap };
}

export function scoreEncodedUtility(document, body) {
  let total = 0;
  for (const term of body.query.bool.should) {
    const feature = term.rank_feature;
    const numeric = term.function_score?.field_value_factor;
    const field = feature?.field ?? numeric.field;
    const [container, key] = field.split('.');
    const value = document[container]?.[key] ?? 0;
    const stored = feature ? quantizeRankFeature(value) : Math.fround(value);
    total += Math.fround(stored * Math.fround(feature?.boost ?? numeric.factor));
  }
  return Math.fround(total);
}

export async function runFavoriteFidelity({ directory, utilityIndex = 'color-exploration-favorite-opt-real-v2', allPresets = true }) {
  await mkdir(path.dirname(directory), { recursive: true }); await mkdir(directory);
  const sourceSnapshot = await favoriteSourceSnapshot(import.meta.url);
  const verified = await loadFavoriteScaleInputs({ scope: 'full', bucketCount: 256 });
  const documents = await loadHueDocuments(256), byId = new Map(documents.map(document => [document.id, document]));
  const baselineIndex = 'color-exploration-shade-hue-256-real-v1';
  for (const index of [baselineIndex, utilityIndex]) assert.equal((await api(index + '/_count')).body.count, 545);
  await writeFile(path.join(directory, 'source-snapshot.json'), JSON.stringify(sourceSnapshot));
  const result = { schemaVersion: 1, startedAt: new Date().toISOString(), sourceSnapshotHash: hash(sourceSnapshot), sourceIdentityHash: verified.identityHash,
    documentValuesHash: hash(documents), count: documents.length, queries: FIDELITY_QUERIES, rows: [],
    limitations: ['All-document service comparisons measure implementation fidelity, not human relevance.', '1e-6 score-gap reporting is a numerical diagnostic, not a perceptual relevance threshold.', 'Validation retrieves indexed IDs through doc values to avoid large stored source blocks; score query, result count and ordering are unchanged. These timings are not a performance benchmark.'] };
  const presets = allPresets ? [0, .5, 1].flatMap(qualityInfluence => [0, 1, 3].map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent }))) : [{}];
  for (const preset of presets) for (const item of FIDELITY_QUERIES) {
    const parameters = { ...FAVORITE_PARAMETERS, bucketCount: 256, ...preset };
    const baseline = await searchIndex(baselineIndex, buildCutoffQuery({ method: FAVORITE_METHOD, query: item.query, parameters, limit: 1000 }));
    assert.equal(baseline.hits.length, 545);
    const fused = await searchIndex(baselineIndex, buildFavoriteOptimizedQuery({ query: item.query, parameters, limit: 1000 }));
    assert.deepEqual(fused.hits, baseline.hits);
    const rankings = { baseline: baseline.hits, fused: fused.hits };
    // Compile each query's descriptors once. Recompiling the entire color query
    // for every image/method made the validation driver needlessly expensive.
    const encodingPlan = createFavoriteUtilityPlan({ requests: [{ query: item.query, parameters }] });
    const encoded = new Map(documents.map(document => [document.id, toFavoriteUtilityDocument(document, encodingPlan)]));
    for (const method of FAVORITE_UTILITY_METHODS) {
      const body = buildFavoriteUtilityQuery({ method, query: item.query, parameters, limit: 1000 });
      const actual = await searchIndex(utilityIndex, body);
      let maximumOracleError = 0;
      for (const hit of actual.hits) {
        const expected = scoreEncodedUtility(encoded.get(hit.id), body);
        maximumOracleError = Math.max(maximumOracleError, Math.abs(expected - hit.score));
      }
      for (const ordinal of [0, 272, 544]) {
        const document = documents[ordinal];
        assert.equal(scoreEncodedUtility(encoded.get(document.id), body), favoriteUtilityReference(byId.get(document.id), item.query, { method, parameters }));
      }
      assert.ok(maximumOracleError <= 2e-7, `${method.id}: service differs from encoding oracle by ${maximumOracleError}`);
      const comparison = compareFavoriteRankings(baseline.hits, actual.hits);
      const bound = { numeric: 3e-7, rank8: 1 / 510 + 3e-7, rank16: 1 / 131070 + 3e-7, rankfloat: .004 }[method.encoding];
      assert.ok(comparison.maximumScoreError <= bound, `${method.id}: declared numeric bound exceeded`);
      result.rows.push({ queryId: item.id, method: method.id, parameters, maximumOracleError, declaredMaximumScoreError: bound, ...comparison });
      rankings[method.id] = actual.hits;
    }
    await writeFile(path.join(directory, 'rankings.jsonl'), JSON.stringify({ queryId: item.id, parameters, rankings }) + '\n', { flag: 'a' });
    console.log(JSON.stringify({ queryId: item.id, preset, completedComparisons: result.rows.length }));
  }
  assert.equal(hash(await favoriteSourceSnapshot(import.meta.url)), result.sourceSnapshotHash, 'Sources changed during fidelity run');
  result.finishedAt = new Date().toISOString(); result.passed = true;
  await writeFile(path.join(directory, 'fidelity.json'), JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), position = args.indexOf('--directory');
  if (position < 0 || !args[position + 1]) throw Error('Provide --directory NEWDIR');
  await runFavoriteFidelity({ directory: path.resolve(args[position + 1]), allPresets: !args.includes('--favorite-only') });
}
