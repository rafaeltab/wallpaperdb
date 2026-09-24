import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidate, METHODS } from './favorite-docvalue-adapter.mjs';

const index = 'color-exploration-fetch-adapter-test';
const context = { corpus: [{ id: 'a' }, { id: 'b' }] };
const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
const metadata = { experiment: 'strict-hue-favorite-utilities', utilityDefinitionVersion: 2,
  mode: 'real', scope: 'full', encodings: ['numeric'], presets: 'all', numericPoints: true };
const precisionMetadata = { ...metadata, experiment: 'strict-hue-favorite-precision-utilities',
  precisionDefinitionVersion: 1, parentUtilityDefinitionVersion: 2, encodings: ['rank27'] };
function backend({ meta = metadata, id = { type: 'keyword' }, point = { type: 'float' }, calls = [] } = {}) {
  return async (route, options) => {
    calls.push({ route, options });
    const responses = {
      '': { version: { number: '2.11.0' } },
      [index + '/_count']: { count: 2 },
      [index + '/_mapping']: { [index]: { mappings: { _meta: meta, _source: { enabled: false },
        properties: { id, utilities: { properties: { test: point } } } } } },
      [index + '/_settings']: { [index]: { settings: { index: { uuid: 'generation', number_of_shards: '1' } } } },
      [index + '/_mget?_source=false']: { docs: ['a', 'b'].map(_id => ({ _id, found: true })) },
      '_nodes/jvm?filter_path=nodes.*.jvm.mem.heap_max_in_bytes': { nodes: { test: { jvm: { mem: { heap_max_in_bytes: 2147483648 } } } } },
    };
    assert.ok(Object.hasOwn(responses, route), route);
    return { body: responses[route] };
  };
}

test('adapter keeps aliases and parent semantics while declaring the fetch refinement source graph', async () => {
  assert.equal(METHODS.length, 3);
  for (const method of METHODS) {
    const candidate = await createCandidate({ config: { id: 'comparison-alias', method: method.id, index,
      parameters: { qualityInfluence: .5, cutoffBlendExponent: 1 } }, context },
    { api: backend({ meta: method.encoding === 'rank27' ? precisionMetadata : metadata }) });
    assert.equal(candidate.metadata.id, 'comparison-alias');
    assert.equal(candidate.metadata.method, method.id);
    assert.equal(candidate.metadata.parentMethod, method.parentMethod);
    assert.equal(candidate.metadata.searchKind, 'favorite-docvalue-fetch');
    assert.ok(candidate.metadata.sourceFiles.includes('exploration/adapter.mjs'));
    assert.ok(candidate.metadata.sourceFiles.includes('exploration/favorite-docvalue-adapter.mjs'));
    assert.ok(candidate.metadata.sourceFiles.includes('exploration/favorite-docvalue-fetch.mjs'));
    assert.equal(candidate.supports({ query }).supported, true);
    assert.equal(candidate.supports({ query: { mode: 'vibe', targets: [{ color: '#ff0000', tolerance: { distance: .1 } }] } }).supported, false);
    const ready = await candidate.prepare();
    assert.equal(ready.index, index);
    assert.equal(ready.completeIdsVerified, true);
    assert.equal(ready.idDocValuesVerified, true);
    assert.equal(ready.parentMethod, method.parentMethod);
  }
});

test('adapter requires an explicit scratch index and rejects incompatible parent or ID representations', async () => {
  for (const badIndex of [undefined, '', 'production']) {
    await assert.rejects(createCandidate({ config: { id: METHODS[0].id, index: badIndex }, context }), /explicit|scratch/i);
  }
  const prepare = async (method, options) => (await createCandidate({ config: { id: method, index }, context }, { api: backend(options) })).prepare();
  for (const id of [undefined, { type: 'text' }, { type: 'keyword', doc_values: false }]) {
    // undefined is explicitly represented as an absent ID mapping.
    await assert.rejects(prepare(METHODS[0].id, { id: id ?? null }), /keyword|doc values/i);
  }
  await assert.rejects(prepare(METHODS[1].id, { meta: metadata }), /complete real-corpus/);
  await assert.rejects(prepare(METHODS[2].id, { point: { type: 'float', index: false } }), /indexed float/);
  await assert.rejects(prepare(METHODS[2].id, { meta: { ...metadata, numericPoints: false } }), /indexed float/);
  await assert.rejects(prepare(METHODS[0].id, { meta: { ...metadata, scope: 'projection' } }), /complete real-corpus/);
});

test('search calls only the doc-value executor and preserves decoded service order, filters and abort signal', async () => {
  const controller = new AbortController();
  for (const method of METHODS) {
    let calls = 0;
    const candidate = await createCandidate({ config: { id: 'alias', method: method.id, index,
      parameters: { qualityInfluence: 1, cutoffBlendExponent: 3 } }, context }, {
      executeSearch: () => assert.fail('Parent search must not execute.'),
      request: async (route, options) => {
        calls++;
        assert.equal(route, index + '/_search?request_cache=false');
        assert.equal(options.signal, controller.signal);
        assert.equal(options.body.stored_fields, '_none_');
        assert.deepEqual(options.body.docvalue_fields, ['id']);
        assert.match(JSON.stringify(options.body), /excluded/);
        assert.match(JSON.stringify(options.body), /eligible/);
        return { wallMs: 4, body: { took: 2, hits: { hits: [
          { fields: { id: ['b'] }, _score: method.encoding === 'numeric' && method.parentMethod.endsWith('sorted') ? null : .5, sort: [.5, 'b'] },
          { fields: { id: ['a'] }, _score: method.encoding === 'numeric' && method.parentMethod.endsWith('sorted') ? null : .5, sort: [.5, 'a'] },
        ] } } };
      },
    });
    const result = await candidate.search({ caseData: { query, eligibleIds: ['eligible'], excludedIds: ['excluded'] }, limit: 2, signal: controller.signal });
    assert.equal(calls, 1);
    assert.deepEqual(result.hits, [{ id: 'b', score: .5 }, { id: 'a', score: .5 }]);
    assert.equal(result.evidence.method, method.id);
    assert.equal(result.evidence.parentMethod, method.parentMethod);
    assert.equal(result.evidence.engine, 'opensearch');
  }
});
