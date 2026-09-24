import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFavoriteUtilityMapping, assertFavoriteUtilityMapping } from './favorite-utility-mapping.mjs';
import { validateUtilityCompletionArtifacts, favoriteUtilityCompletionConfiguration } from './favorite-utility-completion.mjs';
import { hash } from './service.mjs';
import { fileURLToPath } from 'node:url';

const expected = () => ({ dynamic: 'strict', _source: { enabled: true }, _meta: { identity: 'frozen' }, properties: {
  id: { type: 'keyword' }, utilities: { type: 'object', properties: { red: { type: 'float', index: false, doc_values: true } } },
  ranks: { type: 'rank_features', positive_score_impact: true },
} });
const observed = () => ({ dynamic: 'strict', _meta: { identity: 'frozen' }, properties: {
  id: { type: 'keyword' }, utilities: { properties: { red: { type: 'float', index: false } } }, ranks: { type: 'rank_features' },
} });

test('only the observed OpenSearch default omissions normalize to the requested mapping', () => {
  const input = observed(), original = structuredClone(input);
  assert.deepEqual(normalizeFavoriteUtilityMapping(input), expected());
  assert.deepEqual(input, original);
  assert.doesNotThrow(() => assertFavoriteUtilityMapping(input, expected()));
});

test('explicit false/default changes, wrong types, missing fields and metadata all fail', () => {
  const mutations = [
    x => { x._source = { enabled: false }; },
    x => { x.properties.ranks.positive_score_impact = false; },
    x => { x.properties.utilities.properties.red.doc_values = false; },
    x => { x.properties.utilities.properties.red.type = 'double'; },
    x => { x.properties.utilities.type = 'nested'; },
    x => { delete x.properties.utilities.properties.red; },
    x => { x.properties.extra = { type: 'keyword' }; },
    x => { x._meta.identity = 'changed'; },
    x => { x.properties.utilities.properties.red.index = true; },
  ];
  for (const change of mutations) {
    const input = observed(); change(input);
    assert.throws(() => assertFavoriteUtilityMapping(input, expected()), /mapping differs/);
  }
});

test('normalization leaves nested metadata untouched and does not invent unknown defaults', () => {
  const input = { _source: { enabled: true }, _meta: { type: 'float' }, properties: { value: { type: 'double' } } };
  const output = normalizeFavoriteUtilityMapping(input);
  assert.deepEqual(output._meta, { type: 'float' });
  assert.deepEqual(output.properties.value, { type: 'double' });
});

function artifacts() {
  const plan = { utilityCount: 1 }, snapshot = { 'example.mjs': 'unchanged source' };
  const source = { selectedDocumentsHash: 'documents' };
  const mapping = { settings: {}, mappings: expected() };
  delete mapping.mappings._meta;
  const identity = { planHash: hash(plan), source, sourceHashes: { 'example.mjs': hash(snapshot['example.mjs']) }, mappingHash: hash(mapping) };
  const receipt = { experiment: 'strict-hue-favorite-utilities', configuration: { mode: 'real', count: 545, source: true, base: 'http://127.0.0.1:19216', index: 'color-exploration-test' },
    indexed: 545, error: 'Error: Utility mapping differs after indexing beyond default _source.enabled serialization.', base: 'http://127.0.0.1:19216',
    index: 'color-exploration-test', identity, identityHash: hash(identity), source, planHash: hash(plan), sourceSnapshotHash: hash(snapshot) };
  mapping.mappings._meta = { identityHash: receipt.identityHash, planHash: receipt.planHash, sourceDocumentsHash: source.selectedDocumentsHash, count: 545 };
  return { plan, mapping, snapshot, receipt };
}

test('completion accepts only identity-pinned complete original artifacts', () => {
  assert.doesNotThrow(() => validateUtilityCompletionArtifacts(artifacts()));
  for (const change of [
    x => { x.receipt.indexed = 544; },
    x => { x.receipt.error = 'different failure'; },
    x => { x.plan.utilityCount = 2; },
    x => { x.snapshot['example.mjs'] = 'changed source'; },
    x => { x.mapping.mappings.properties.id.type = 'text'; },
    x => { x.receipt.identity.planHash = 'changed identity'; },
    x => { x.receipt.configuration.base = 'http://other-host:9200'; },
  ]) {
    const input = artifacts(); change(input);
    assert.throws(() => validateUtilityCompletionArtifacts(input));
  }
});

test('completion rejects missing, repeated and unknown configuration options', () => {
  for (const args of [[], ['--receipt', '/tmp/index.json'], ['--anything', 'yes'], ['--receipt', '/tmp/a', '--receipt', '/tmp/b', '--directory', '/tmp/c']]) {
    assert.throws(() => favoriteUtilityCompletionConfiguration(args));
  }
  assert.throws(() => favoriteUtilityCompletionConfiguration(['--receipt', '/tmp/index.json', '--directory', fileURLToPath(new URL('./test-output', import.meta.url))]), /outside the worktree/);
});
