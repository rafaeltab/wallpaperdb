import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCandidate, METHODS } from './favorite-maxima-adapter.mjs';
import { validateFavoriteOptimizationCandidates, compileFavoriteOptimizationQuery, favoriteOptimizationCases } from './favorite-optimization-benchmark.mjs';

const index = 'color-exploration-maxima-adapter-test', context = { corpus: [{ id: 'a' }, { id: 'b' }] };
const query = { mode: 'vibe', targets: [{ color: '#ff0000' }, { color: '#00ff00' }] };
const metadata = { experiment: 'strict-hue-favorite-utilities', utilityDefinitionVersion: 2,
  mode: 'real', scope: 'full', encodings: ['numeric'], presets: 'all', numericPoints: true };
function backend({ meta = metadata, id = { type: 'keyword' }, point = { type: 'float' } } = {}) {
  return async route => {
    const responses = {
      '': { version: { number: '2.11.0' } }, [index + '/_count']: { count: 2 },
      [index + '/_mapping']: { [index]: { mappings: { _meta: meta, _source: { enabled: false }, properties: { id, utilities: { properties: { test: point } } } } } },
      [index + '/_settings']: { [index]: { settings: { index: { uuid: 'generation', number_of_shards: '1' } } } },
      [index + '/_mget?_source=false']: { docs: ['a', 'b'].map(_id => ({ _id, found: true })) },
      '_nodes/jvm?filter_path=nodes.*.jvm.mem.heap_max_in_bytes': { nodes: { test: { jvm: { mem: { heap_max_in_bytes: 2147483648 } } } } },
    };
    assert.ok(Object.hasOwn(responses, route), route); return { body: responses[route] };
  };
}

test('standalone adapter preserves parent preparation and support while declaring its own method and sources', async () => {
  assert.equal(METHODS.length, 1);
  const candidate = await createCandidate({ config: { id: 'alias', method: METHODS[0].id, index }, context }, { api: backend() });
  assert.equal(candidate.metadata.id, 'alias'); assert.equal(candidate.metadata.method, METHODS[0].id);
  assert.equal(candidate.metadata.parentMethod, 'favorite-utility-bounded');
  for (const file of ['adapter', 'favorite-bounded-utilities', 'favorite-maxima-bounded-utilities', 'favorite-maxima-adapter']) assert.ok(candidate.metadata.sourceFiles.includes('exploration/' + file + '.mjs'));
  assert.equal(candidate.supports({ query }).supported, true);
  assert.equal(candidate.supports({ query: { mode: 'vibe', targets: [{ color: '#ff0000', tolerance: { distance: .1 } }] } }).supported, false);
  const ready = await candidate.prepare();
  assert.equal(ready.completeIdsVerified, true); assert.equal(ready.idDocValuesVerified, true);
  assert.equal(ready.parentMethod, 'favorite-utility-bounded');
});

test('explicit scratch index, complete point representation and keyword ID doc values remain mandatory', async () => {
  for (const invalid of [undefined, '', 'production']) await assert.rejects(createCandidate({ config: { id: METHODS[0].id, index: invalid }, context }), /explicit|scratch/i);
  await assert.rejects(createCandidate({ config: { id: 'unknown', index }, context }), /Unknown/);
  const prepare = async options => (await createCandidate({ config: { id: METHODS[0].id, index }, context }, { api: backend(options) })).prepare();
  for (const id of [null, { type: 'text' }, { type: 'keyword', doc_values: false }]) await assert.rejects(prepare({ id }), /keyword|doc values/i);
  await assert.rejects(prepare({ point: { type: 'float', index: false } }), /indexed float/);
  await assert.rejects(prepare({ meta: { ...metadata, numericPoints: false } }), /indexed float/);
  await assert.rejects(prepare({ meta: { ...metadata, scope: 'projection' } }), /complete real-corpus/);
});

test('search invokes the actual maxima PIT executor with filters, controls and cancellation', async () => {
  const controller = new AbortController(), calls = [];
  const candidate = await createCandidate({ config: { id: METHODS[0].id, index, parameters: { qualityInfluence: 1, cutoffBlendExponent: 3 } }, context }, {
    executeSearch: () => assert.fail('Parent adapter search must not execute.'),
    request: async (route, options) => {
      calls.push({ route, options });
      if (route.includes('/_search/point_in_time?')) return { body: { pit_id: 'test-pit', _shards: { failed: 0 } } };
      if (options.method === 'DELETE') return { body: { pits: [{ pit_id: 'test-pit', successful: true }] } };
      assert.equal(options.signal.aborted, false); assert.equal(options.body.stored_fields, '_none_');
      assert.deepEqual(options.body.docvalue_fields, ['id']);
      const text = JSON.stringify(options.body);
      assert.match(text, /excluded/); assert.match(text, /eligible/); assert.match(text, /q100_w3/);
      const seed = options.body.track_scores === false;
      return { wallMs: 1, body: { took: 1, timed_out: false, _shards: { failed: 0 }, hits: { hits: [
        { fields: { id: ['a'] }, _score: seed ? null : .8, ...(seed ? { sort: [1, 'a'] } : {}) },
      ] } } };
    },
  });
  const result = await candidate.search({ caseData: { query, eligibleIds: ['eligible'], excludedIds: ['excluded'] }, limit: 1, signal: controller.signal });
  assert.equal(calls.length, 6); assert.deepEqual(result.hits, [{ id: 'a', score: .8 }]);
  assert.equal(result.evidence.method, METHODS[0].id); assert.equal(result.evidence.parentMethod, 'favorite-utility-bounded');
  assert.equal(result.evidence.globalBounds.maximaBounds.addedRanges, 2);
  controller.abort(Error('cancelled'));
  await assert.rejects(candidate.search({ caseData: { query }, limit: 1, signal: controller.signal }), /cancelled/);
  assert.equal(calls.length, 6);
});

test('scale configs compile through explicit executors and feedback uses the standalone adapter', async () => {
  for (const file of ['favorite-maxima-projection-1m.json', 'favorite-maxima-full-1m.json']) {
    const document = JSON.parse(await readFile(new URL('./configs/' + file, import.meta.url), 'utf8'));
    const candidates = validateFavoriteOptimizationCandidates(document);
    assert.equal(candidates.length, 3);
    assert.equal(candidates.at(-1).method, METHODS[0].id);
    for (const candidate of candidates) {
      const builder = (await import(candidate.builder.module))[candidate.builder.export];
      const executor = (await import(candidate.executor.module))[candidate.executor.export];
      assert.equal(typeof executor, 'function');
      for (const item of favoriteOptimizationCases([candidate], { selectivities: ['all', 'partition10', 'tag1'] })) assert.equal(compileFavoriteOptimizationQuery(item, builder).size, 20);
    }
  }
  const feedback = JSON.parse(await readFile(new URL('./configs/favorite-maxima-feedback.json', import.meta.url), 'utf8'));
  assert.equal(feedback.candidates.length, 4);
  assert.equal(feedback.candidates.at(-1).module, './favorite-maxima-adapter.mjs');
  assert.equal(feedback.workload.accuracyLimit, 1000);
});
