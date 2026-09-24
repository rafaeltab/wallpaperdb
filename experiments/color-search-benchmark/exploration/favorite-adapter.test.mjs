import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidate } from './adapter.mjs';
import { indexForMethod } from './registry.mjs';
const index = 'color-exploration-favorite-opt-real-v4';
const metadata = { experiment: 'strict-hue-favorite-utilities', utilityDefinitionVersion: 2, mode: 'real', scope: 'full', encodings: ['numeric', 'rank8', 'rank16', 'rankfloat'], presets: 'all' };
function backend(meta, selectedIndex = index, properties) {
  return async route => {
    const responses = {
      '': { version: { number: '2.11.0' } },
      [index + '/_count']: { count: 2 },
      [index + '/_mapping']: { [index]: { mappings: { _meta: meta, properties } } },
      [index + '/_settings']: { [index]: { settings: { index: { uuid: 'test-generation', number_of_shards: '1' } } } },
      [index + '/_mget?_source=false']: { docs: ['a', 'b'].map(_id => ({ _id, found: true })) },
      '_nodes/jvm?filter_path=nodes.*.jvm.mem.heap_max_in_bytes': { nodes: { test: { jvm: { mem: { heap_max_in_bytes: 2147483648 } } } } },
    };
    const normalized = route.replace(selectedIndex, index);
    assert.ok(Object.hasOwn(responses, normalized), route);
    const body = responses[normalized];
    return { body: Object.hasOwn(body, index) ? { [selectedIndex]: body[index] } : body };
  };
}
async function prepare(meta, parameters = {}) {
  const candidate = await createCandidate({ config: { id: 'favorite-utility-rank16', parameters }, context: { corpus: [{ id: 'a' }, { id: 'b' }] } }, { api: backend(meta) });
  return candidate.prepare();
}
test('utility feedback rejects missing representations and presets instead of silently scoring absent fields as zero', async () => {
  for (const change of [{ utilityDefinitionVersion: 1 }, { scope: 'projection' }, { mode: 'scale' }, { experiment: 'other' }, { encodings: ['rank8'] }]) await assert.rejects(() => prepare({ ...metadata, ...change }), /complete real-corpus/);
  await assert.rejects(() => prepare({ ...metadata, presets: 'favorite' }, { qualityInfluence: 1 }), /not indexed/);
  const accepted = await prepare(metadata, { qualityInfluence: 1 });
  assert.equal(accepted.completeIdsVerified, true);
  assert.equal(accepted.execution.retrieval, 'exact-stored-objective');
  assert.equal(accepted.execution.objectiveApproximation, true);
});
test('new methods route to their dedicated observations without replacing explicit scale indexes', () => {
  assert.equal(indexForMethod('favorite-fused-script'), 'color-exploration-shade-hue-256-real-v1');
  assert.equal(indexForMethod('favorite-utility-rank16'), index);
  assert.equal(indexForMethod('favorite-utility-rank16', 'color-exploration-explicit'), 'color-exploration-explicit');
  assert.equal(indexForMethod('favorite-utility-rank18'), 'color-exploration-favorite-precision-real-v1');
  assert.equal(indexForMethod('favorite-utility-rank27', 'color-exploration-explicit'), 'color-exploration-explicit');
  assert.equal(indexForMethod('favorite-utility-sorted'), 'color-exploration-favorite-points-real-v2');
});
test('numeric-sort feedback rejects doc-values-only fields and absent point-index metadata', async () => {
  const selectedIndex = 'color-exploration-favorite-points-real-v2';
  const meta = { ...metadata, numericPoints: true, encodings: ['numeric'] };
  const prepareSorted = async (data, field) => (await createCandidate({ config: { id: 'favorite-utility-sorted' }, context: { corpus: [{ id: 'a' }, { id: 'b' }] } }, { api: backend(data, selectedIndex, { utilities: { properties: { utility: field } } }) })).prepare();
  const accepted = await prepareSorted(meta, { type: 'float' });
  assert.equal(accepted.completeIdsVerified, true);
  await assert.rejects(() => prepareSorted({ ...meta, numericPoints: false }, { type: 'float' }), /indexed float/);
  await assert.rejects(() => prepareSorted(meta, { type: 'float', index: false }), /indexed float/);
  await assert.rejects(() => prepareSorted(meta, { type: 'float', doc_values: false }), /indexed float/);
});
test('precision feedback verifies its own definition and encoding before accepting a full-corpus index', async () => {
  const meta = { ...metadata, experiment: 'strict-hue-favorite-precision-utilities', precisionDefinitionVersion: 1, parentUtilityDefinitionVersion: 2, encodings: ['rank18', 'rank27'] };
  const precisionIndex = 'color-exploration-favorite-precision-real-v1';
  const preparePrecision = async data => (await createCandidate({ config: { id: 'favorite-utility-rank18' }, context: { corpus: [{ id: 'a' }, { id: 'b' }] } }, { api: backend(data, precisionIndex) })).prepare();
  const accepted = await preparePrecision(meta);
  assert.equal(accepted.index, precisionIndex);
  assert.equal(accepted.execution.objectiveApproximation, true);
  for (const change of [{ precisionDefinitionVersion: 2 }, { parentUtilityDefinitionVersion: 1 }, { encodings: ['rank27'] }, { scope: 'projection' }, { experiment: 'strict-hue-favorite-utilities' }]) await assert.rejects(() => preparePrecision({ ...meta, ...change }), /complete real-corpus/);
});
