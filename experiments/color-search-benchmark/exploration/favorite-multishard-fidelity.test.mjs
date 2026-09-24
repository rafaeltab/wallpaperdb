import test from 'node:test';
import assert from 'node:assert/strict';
import { multishardConfiguration, multishardRequests, multishardMapping, validateMultishardDistribution,
  writeMultishardDocuments, captureMultishardExecution } from './favorite-multishard-fidelity.mjs';
import { createFavoriteUtilityPlan } from './favorite-utilities.mjs';

test('configuration requires a fresh external directory and safe scratch index, with no alternate service option', () => {
  const config = multishardConfiguration(['--directory', '/tmp/multishard-test']);
  assert.equal(config.base, 'http://127.0.0.1:19216');
  assert.equal(config.index, 'color-exploration-favorite-multishard-real-v1');
  for (const args of [[], ['--directory', '.'], ['--directory', '/'], ['--directory', '/tmp/a', '--base', 'http://127.0.0.1:19217'],
    ['--directory', '/tmp/a', '--index', 'production'], ['--directory', '/tmp/a', '--directory', '/tmp/b']]) assert.throws(() => multishardConfiguration(args));
});

test('projection covers all sixteen queries and nine controls plus duplicate diagnostics with numeric points', () => {
  const requests = multishardRequests(), plan = createFavoriteUtilityPlan({ requests });
  assert.equal(requests.length, 146); assert.equal(plan.utilityCount, 189);
  const mapping = multishardMapping(plan, { identity: 'example' });
  assert.equal(mapping.settings.number_of_shards, 3); assert.equal(mapping.settings.number_of_replicas, 0);
  assert.equal(mapping.mappings._source.enabled, false);
  assert.equal(mapping.mappings.properties.id.type, 'keyword');
  assert.ok(Object.values(mapping.mappings.properties.utilities.properties).every(field => field.type === 'float' && field.index !== false && field.doc_values !== false));
});

test('three nonempty shard inventories must form exactly the corpus, with no duplicates or omissions', () => {
  assert.deepEqual(validateMultishardDistribution([['a'], ['b', 'c'], ['d']], ['a', 'b', 'c', 'd']), [1, 2, 1]);
  for (const bad of [[['a'], ['b']], [['a'], [], ['b']], [['a'], ['b'], ['a']], [['a'], ['b'], ['c']]]) {
    assert.throws(() => validateMultishardDistribution(bad, ['a', 'b', 'c', 'd']));
  }
});

test('bulk writes use create and require every201 acknowledgement; no failed request is retried', async () => {
  const documents = [{ id: 'a', utilities: {} }, { id: 'b', utilities: {} }], calls = [], records = [];
  const request = async (route, options) => {
    calls.push({ route, options });
    assert.equal(route, 'color-exploration-test/_bulk'); assert.equal(options.method, 'POST');
    assert.equal(options.body.split('\n').filter(Boolean).length, 4);
    assert.ok(options.body.startsWith('{"create":'));
    return { body: { errors: false, items: documents.map(d => ({ create: { status: 201, _id: d.id } })) } };
  };
  const result = await writeMultishardDocuments({ index: 'color-exploration-test', documents, request, record: async row => records.push(row) });
  assert.equal(result.indexed, 2); assert.equal(calls.length, 1); assert.equal(records.length, 1);
  let failures = 0;
  await assert.rejects(writeMultishardDocuments({ index: 'color-exploration-test', documents,
    record: async () => {}, request: async () => { failures++; return { body: { errors: true, items: [{ create: { status: 409, _id: 'a' } }] } }; } }));
  assert.equal(failures, 1);
});

test('dispatch calls actual executors and validates every global search covers three successful shards', async () => {
  const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] }, calls = [];
  const request = async (route, options) => {
    calls.push({ route, options });
    if (route.includes('/_search/point_in_time?')) return { body: { pit_id: 'p', _shards: { total: 3, successful: 3, failed: 0 } } };
    if (options.method === 'DELETE') return { body: { pits: [{ pit_id: 'p', successful: true }] } };
    return { body: { took: 0, timed_out: false, _shards: { total: 3, successful: 3, failed: 0 }, hits: { hits: [
      { fields: { id: ['a'] }, _score: .8, sort: [options.body.track_scores === false ? 1 : .8, 'a'] },
    ] } } };
  };
  for (const method of ['favorite-utility-numeric-docvalues', 'favorite-utility-sorted-docvalues', 'favorite-utility-bounded', 'favorite-utility-maxima-bounded']) {
    calls.length = 0;
    const result = await captureMultishardExecution(method, { index: 'color-exploration-test', query, limit: 1 }, { request });
    assert.equal(result.result.hits[0].id, 'a');
    assert.equal(calls.length, method.includes('bounded') ? 5 : 1);
    if (method.includes('bounded')) assert.equal(calls.at(-1).options.method, 'DELETE');
  }
  await assert.rejects(captureMultishardExecution('favorite-utility-numeric-docvalues', { index: 'color-exploration-test', query },
    { request: async () => ({ body: { _shards: { total: 1, successful: 1, failed: 0 }, hits: { hits: [] } } }) }), /three|shards/);
});
