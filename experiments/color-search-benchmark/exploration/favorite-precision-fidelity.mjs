// Offline all-document comparison only. User ranking remains inside OpenSearch.
import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIDELITY_QUERIES, compareFavoriteRankings } from './favorite-optimization-fidelity.mjs';
import { FAVORITE_METHOD, FAVORITE_PARAMETERS, loadFavoriteScaleInputs } from './favorite-scale-corpus.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { loadHueDocuments } from './hue-index.mjs';
import { buildCutoffQuery } from './methods-cutoff.mjs';
import { compileFavoriteScorePlan, scoreFavoriteReference } from './favorite-optimized-scoring.mjs';
import { FAVORITE_UTILITY_PRESETS, createFavoriteUtilityPlan, toFavoriteUtilityDocument, quantizeRankFeature, supportsFavoriteUtilities } from './favorite-utilities.mjs';
import { assertFavoriteUtilityMapping } from './favorite-utility-mapping.mjs';
import {
  FAVORITE_PRECISION_METHODS, FAVORITE_PRECISION_DEFINITION, favoritePrecisionMapping,
  toFavoritePrecisionDocument, favoritePrecisionDigits, buildFavoritePrecisionQuery,
} from './favorite-precision-utilities.mjs';
import { api, BASE, searchIndex, hash, safeIndexName } from './service.mjs';

const REPOSITORY = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const BASELINE_INDEX = 'color-exploration-shade-hue-256-real-v1';
const encodings = FAVORITE_PRECISION_METHODS.map(method => method.encoding);
const allControls = () => FAVORITE_UTILITY_PRESETS.qualityInfluence.flatMap(qualityInfluence => FAVORITE_UTILITY_PRESETS.cutoffBlendExponent.map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent })));
export const PRECISION_FIDELITY_BOUNDS = Object.freeze(Object.fromEntries(encodings.map(encoding => [encoding, Object.freeze({
  targetQuantization: .5 / FAVORITE_PRECISION_DEFINITION.encodings[encoding].scale,
  serviceOracle: 2e-7, originalScore: .5 / FAVORITE_PRECISION_DEFINITION.encodings[encoding].scale + 3e-7,
})])));

export function precisionFidelityConfiguration(args = []) {
  const values = { allPresets: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--favorite-only') { values.allPresets = false; continue; }
    if (!['--directory', '--index'].includes(args[i])) throw Error('Unknown precision fidelity option: ' + args[i]);
    const key = args[i].slice(2), value = args[++i];
    if (!value || value.startsWith('--')) throw Error('Missing precision fidelity option: ' + key);
    values[key] = value;
  }
  if (!values.directory) throw Error('Provide --directory NEW_EXTERNAL_DIRECTORY.');
  const directory = path.resolve(values.directory);
  if (directory === path.parse(directory).root || directory === REPOSITORY || directory.startsWith(REPOSITORY + path.sep)) throw Error('Fidelity artifacts must use a new external directory.');
  return { directory, precisionIndex: safeIndexName(values.index ?? 'color-exploration-favorite-precision-real-v1'), allPresets: values.allPresets };
}

export function createPrecisionFidelityContext(query, parameters = {}) {
  parameters = { ...FAVORITE_PARAMETERS, bucketCount: 256, ...parameters };
  return {
    query, parameters,
    utilityPlan: createFavoriteUtilityPlan({ requests: [{ query, parameters }] }),
    utilities: supportsFavoriteUtilities('favorite-utility-numeric', query, { parameters }).utilities,
    nativePlan: compileFavoriteScorePlan({ query, parameters }),
    baselineBody: buildCutoffQuery({ method: FAVORITE_METHOD, query, parameters, limit: 1000 }),
    bodies: Object.fromEntries(FAVORITE_PRECISION_METHODS.map(method => [method.id, buildFavoritePrecisionQuery({ method, query, parameters, limit: 1000 })])),
  };
}

export function reconstructPrecisionQueryScore(document, body) {
  let sum = 0;
  assert.ok(Array.isArray(body.query?.bool?.should), 'Expected precision rank-feature clauses');
  for (const clause of body.query.bool.should) {
    const feature = clause.rank_feature;
    assert.ok(feature && feature.linear && Number.isFinite(feature.boost) && feature.boost > 0, 'Expected positive linear rank feature');
    const names = feature.field.split('.');
    assert.equal(names.length, 2, 'Expected a preset field and digit key');
    const value = document[names[0]]?.[names[1]] ?? 0;
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 511, 'Invalid base512 digit');
    assert.equal(quantizeRankFeature(value), value, 'Feature encoding lost a digit');
    sum += Math.fround(value * Math.fround(feature.boost));
  }
  return Math.fround(sum);
}

export function precisionFidelityOracle(measurement, context) {
  const numeric = toFavoriteUtilityDocument(measurement, context.utilityPlan, { encodings: ['numeric'] });
  const encoded = toFavoritePrecisionDocument(measurement, context.utilityPlan);
  const targetCount = context.nativePlan.targets.length;
  let numericScore = 0;
  // Keep repeated requested targets: the index plan deduplicates utility keys,
  // while the query independently averages each requested color.
  for (const target of context.utilities) {
    assert.ok(Object.hasOwn(numeric.utilities, target.key), 'A target utility was not precomputed');
    numericScore += Math.fround(numeric.utilities[target.key] * Math.fround(1 / targetCount));
  }
  const maximumTargetErrors = {};
  for (const encoding of encodings) {
    const scale = FAVORITE_PRECISION_DEFINITION.encodings[encoding].scale;
    maximumTargetErrors[encoding] = Math.max(0, ...Object.values(numeric.utilities).map(value => {
      const integer = favoritePrecisionDigits(value, encoding).reduce((sum, digit) => sum * 512 + digit, 0);
      const error = Math.abs(integer / scale - value);
      assert.ok(error <= PRECISION_FIDELITY_BOUNDS[encoding].targetQuantization + 2e-16, 'Fixed-point utility quantization bound exceeded');
      return error;
    }));
  }
  return {
    id: measurement.id, native: scoreFavoriteReference(measurement, context.nativePlan), numeric: Math.fround(numericScore),
    scores: Object.fromEntries(FAVORITE_PRECISION_METHODS.map(method => [method.id, reconstructPrecisionQueryScore(encoded, context.bodies[method.id])])),
    maximumTargetErrors,
  };
}

export function assertPrecisionFidelityMetadata(snapshot, { sourceIdentityHash, documentsHash, allPresets = true, plan }) {
  const metadata = snapshot.mapping?._meta;
  assert.equal(snapshot.count, 545, 'Precision index must contain all545 assets');
  assert.ok(snapshot.uuid, 'Precision index UUID is required');
  assert.equal(metadata?.experiment, 'strict-hue-favorite-precision-utilities');
  assert.equal(metadata.precisionDefinitionVersion, FAVORITE_PRECISION_DEFINITION.version);
  assert.equal(metadata.parentUtilityDefinitionVersion, FAVORITE_PRECISION_DEFINITION.parentUtilityDefinitionVersion);
  assert.equal(metadata.mode, 'real'); assert.equal(metadata.scope, 'full'); assert.equal(metadata.count, 545);
  assert.match(metadata.identityHash, /^[0-9a-f]{64}$/);
  assert.equal(metadata.sourceIdentityHash, sourceIdentityHash);
  assert.equal(metadata.sourceDocumentsHash, documentsHash);
  assert.ok(['all', 'favorite'].includes(metadata.presets), 'Unknown indexed control presets');
  if (allPresets) assert.equal(metadata.presets, 'all', 'All-preset fidelity requires all indexed presets');
  assert.deepEqual([...metadata.encodings].sort(), [...encodings].sort(), 'Both precision encodings are required');
  assert.equal(metadata.planHash, hash(plan), 'Precision index plan differs');
  const expected = favoritePrecisionMapping(plan, { source: snapshot.mapping._source?.enabled !== false });
  expected.mappings._meta = metadata;
  assertFavoriteUtilityMapping(snapshot.mapping, expected.mappings);
}

async function captureIndex(index) {
  const [count, mapping, settings, stats] = await Promise.all([
    api(index + '/_count'), api(index + '/_mapping'), api(index + '/_settings'), api(index + '/_stats/docs,indexing'),
  ]);
  const selected = settings.body[index]?.settings?.index, primary = stats.body.indices?.[index]?.primaries;
  assert.ok(selected?.uuid && primary?.indexing, 'Missing index fingerprint');
  const result = { at: new Date().toISOString(), index, count: count.body.count, uuid: selected.uuid,
    mapping: mapping.body[index]?.mappings, settings: selected, stats: stats.body };
  result.generation = { count: result.count, uuid: result.uuid, mappingHash: hash(result.mapping), docs: primary.docs,
    indexingTotal: primary.indexing.index_total, deleteTotal: primary.indexing.delete_total };
  return result;
}

export async function runFavoritePrecisionFidelity({ directory, precisionIndex = 'color-exploration-favorite-precision-real-v1', allPresets = true }) {
  const configuration = precisionFidelityConfiguration(['--directory', directory, '--index', precisionIndex, ...(allPresets ? [] : ['--favorite-only'])]);
  assert.equal(BASE, 'http://127.0.0.1:19216', 'Precision fidelity must use the retained real-corpus service on19216');
  await mkdir(path.dirname(configuration.directory), { recursive: true });
  await mkdir(configuration.directory); // Never overwrite prior evidence.
  const save = (name, value) => writeFile(path.join(configuration.directory, name), JSON.stringify(value, null, 2), { flag: 'wx' });
  const append = (name, value) => appendFile(path.join(configuration.directory, name), JSON.stringify(value) + '\n');
  const result = { schemaVersion: 1, startedAt: new Date().toISOString(), configuration, count: 545,
    definition: FAVORITE_PRECISION_DEFINITION, bounds: PRECISION_FIDELITY_BOUNDS, queries: FIDELITY_QUERIES, rows: [], baselineChecks: [],
    limitations: ['All-document comparisons verify implementation fidelity, not human relevance.',
      'The1e-6 meaningful-inversion threshold is numerical, not a perceptual relevance threshold.',
      'Integer quantization and float32 arithmetic can reorder close scores even when the underlying mathematical formula is preserved.'] };
  try {
    const sourceSnapshot = await favoriteSourceSnapshot(import.meta.url);
    result.sourceSnapshotHash = hash(sourceSnapshot); await save('source-snapshot.json', sourceSnapshot);
    const verified = await loadFavoriteScaleInputs({ scope: 'full', bucketCount: 256 });
    const documents = await loadHueDocuments(256), ids = documents.map(document => document.id).sort();
    assert.equal(documents.length, 545); assert.equal(new Set(ids).size, 545);
    result.documentValuesHash = hash(documents); result.sourceIdentityHash = verified.identityHash;
    result.source = verified.source;
    const before = { baseline: await captureIndex(BASELINE_INDEX), precision: await captureIndex(configuration.precisionIndex) };
    assert.equal(before.baseline.count, 545);
    assert.equal(before.baseline.mapping?._meta?.identityHash, verified.source.identityHash);
    assert.equal(before.baseline.mapping?._meta?.descriptorHash, verified.source.descriptorHash);
    const indexedPresets = before.precision.mapping?._meta?.presets === 'all' ? allControls() : [{}];
    const completePlan = createFavoriteUtilityPlan({ presets: indexedPresets });
    assertPrecisionFidelityMetadata(before.precision, { sourceIdentityHash: verified.identityHash, documentsHash: result.documentValuesHash, allPresets, plan: completePlan });
    result.before = before; await save('index-before.json', before);
    for (const index of [BASELINE_INDEX, configuration.precisionIndex]) {
      const body = (await api(index + '/_mget?_source=false', { method: 'POST', body: { ids } })).body;
      assert.deepEqual(body.docs.map(document => document._id), ids);
      assert.ok(body.docs.every(document => document.found), 'Index omitted a required corpus ID');
    }
    const presets = allPresets ? allControls() : [{}];
    result.expectedQueryPresetCombinations = presets.length * FIDELITY_QUERIES.length;
    for (const preset of presets) for (const item of FIDELITY_QUERIES) {
      const context = createPrecisionFidelityContext(item.query, preset);
      const oracles = documents.map(document => precisionFidelityOracle(document, context));
      const byId = new Map(oracles.map(oracle => [oracle.id, oracle]));
      await append('requests.jsonl', { queryId: item.id, parameters: context.parameters, baseline: context.baselineBody, precision: context.bodies });
      await append('oracles.jsonl', { queryId: item.id, parameters: context.parameters, documents: oracles });
      const baseline = await searchIndex(BASELINE_INDEX, context.baselineBody);
      assert.deepEqual(baseline.hits.map(hit => hit.id).sort(), ids, 'Baseline query must rank the complete corpus');
      const maximumNativeOracleError = Math.max(...baseline.hits.map(hit => Math.abs(hit.score - byId.get(hit.id).native)));
      assert.ok(maximumNativeOracleError <= 2e-7, 'Native baseline differs from indexed-measurement arithmetic');
      result.baselineChecks.push({ queryId: item.id, parameters: context.parameters, maximumNativeOracleError });
      const rankings = { baseline: baseline.hits }, evidence = { baseline: baseline.evidence };
      for (const method of FAVORITE_PRECISION_METHODS) {
        const actual = await searchIndex(configuration.precisionIndex, context.bodies[method.id]);
        assert.deepEqual(actual.hits.map(hit => hit.id).sort(), ids, 'Precision query must rank the complete corpus');
        const maximumOracleError = Math.max(...actual.hits.map(hit => Math.abs(hit.score - byId.get(hit.id).scores[method.id])));
        const maximumTargetQuantizationError = Math.max(...oracles.map(oracle => oracle.maximumTargetErrors[method.encoding]));
        const comparison = compareFavoriteRankings(baseline.hits, actual.hits), bounds = PRECISION_FIDELITY_BOUNDS[method.encoding];
        assert.ok(maximumOracleError <= bounds.serviceOracle, `${method.id} exceeds service/oracle error bound: ${maximumOracleError}`);
        assert.ok(comparison.maximumScoreError <= bounds.originalScore, `${method.id} exceeds declared score bound: ${comparison.maximumScoreError}`);
        result.rows.push({ queryId: item.id, method: method.id, parameters: context.parameters, maximumOracleError,
          maximumTargetQuantizationError, declaredMaximumScoreError: bounds.originalScore, ...comparison });
        rankings[method.id] = actual.hits; evidence[method.id] = actual.evidence;
      }
      await append('rankings.jsonl', { queryId: item.id, parameters: context.parameters, rankings, evidence });
      const progress = { queryId: item.id, preset, completedQueryPresetCombinations: result.baselineChecks.length, completedComparisons: result.rows.length };
      await append('progress.jsonl', progress); console.log(JSON.stringify(progress));
    }
    result.after = { baseline: await captureIndex(BASELINE_INDEX), precision: await captureIndex(configuration.precisionIndex) };
    await save('index-after.json', result.after);
    for (const kind of ['baseline', 'precision']) assert.deepEqual(result.after[kind].generation, before[kind].generation, `${kind} index changed during fidelity run`);
    assert.equal(hash(await favoriteSourceSnapshot(import.meta.url)), result.sourceSnapshotHash, 'Sources changed during fidelity run');
    assert.equal(result.baselineChecks.length, result.expectedQueryPresetCombinations);
    assert.equal(result.rows.length, result.expectedQueryPresetCombinations * FAVORITE_PRECISION_METHODS.length);
    result.finishedAt = new Date().toISOString(); result.passed = true;
    await save('fidelity.json', result); return result;
  } catch (error) {
    await save('failure.json', { ...result, failedAt: new Date().toISOString(), error: String(error.stack ?? error) });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runFavoritePrecisionFidelity(precisionFidelityConfiguration(process.argv.slice(2)));
}
