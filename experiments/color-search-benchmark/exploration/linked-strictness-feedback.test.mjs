import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidate } from './linked-strictness-feedback.mjs';
import { createLinkedStrictnessPlan, linkedStrictnessBank, linkedStrictnessMetadata } from './linked-strictness.mjs';
import { linkedStrictnessMapping } from './linked-strictness-index.mjs';

const context = { corpus: [{ id: 'a', filename: '/a.jpg' }, { id: 'b', filename: '/b.webp' },
  { id: 'fixture', filename: '/fixture.svg', cohort: 'controlled-fixture' }] };
const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
const config = { id: 'linked-test', variant: 'linked', bankId: 'linked-3', stepIndex: 1 };

test('feedback accepts the harness-normalized empty parameters object but rejects actual overrides', async () => {
  const dependencies = { sourceFiles: async () => [] };
  const candidate = await createCandidate({ config: { ...config, parameters: {} }, context }, dependencies);
  assert.equal(candidate.supports({ query }).supported, true);
  assert.equal(candidate.metadata.parameters.qualityInfluence, .5);
  assert.equal(candidate.metadata.parameters.cutoffBlendExponent, 1);
  for (const parameters of [{ qualityInfluence: 1 }, { qualityInfluence: .5 }, null, [], 0, '']) {
    await assert.rejects(createCandidate({ config: { ...config, parameters }, context }, dependencies), /parameter overrides/);
  }
});

function backend({ mutate = () => {} } = {}) {
  const bank = linkedStrictnessBank('linked-3'), mapping = linkedStrictnessMapping(createLinkedStrictnessPlan(bank.id)).mappings;
  mapping._meta = { experiment: 'strict-hue-favorite-utilities', utilityDefinitionVersion: 2, mode: 'real', scope: 'full',
    count: context.corpus.length, presets: 'linked', encodings: ['numeric'], numericPoints: true, identityHash: 'identity', planHash: 'plan',
    utilities: bank.utilityCount, linkedStrictness: linkedStrictnessMetadata(bank.id) };
  const bodies = {
    '': { version: { number: '2.11.0' } },
    [bank.index + '/_count']: { count: context.corpus.length, _shards: { failed: 0 } },
    [bank.index + '/_mapping']: { [bank.index]: { mappings: mapping } },
    [bank.index + '/_settings']: { [bank.index]: { settings: { index: { uuid: 'uuid', number_of_shards: '1' } } } },
    [bank.index + '/_mget?_source=false']: { docs: context.corpus.map(asset => ({ _id: asset.id, found: true })) },
    '_nodes/jvm?filter_path=nodes.*.jvm.mem.heap_max_in_bytes': { nodes: { node: { jvm: { mem: { heap_max_in_bytes: 4294967296 } } } } },
  };
  mutate(bodies, mapping);
  return async route => { assert.ok(Object.hasOwn(bodies, route), route); return { body: bodies[route] }; };
}

test('feedback adapter verifies full compact schema and corpus while reporting real-only search eligibility', async () => {
  const candidate = await createCandidate({ config, context }, { api: backend(), sourceFiles: async () => ['exploration/linked-strictness-feedback.mjs'] });
  const prepared = await candidate.prepare();
  assert.equal(prepared.count, 3); assert.equal(prepared.searchableRealCount, 2); assert.equal(prepared.excludedFixtureCount, 1);
  assert.equal(prepared.completeIdsVerified, true); assert.equal(prepared.utilityFields, 10044);
  assert.equal(candidate.metadata.parameters.qualityInfluence, .5); assert.equal(candidate.metadata.parameters.cutoffBlendExponent, 1);
  assert.equal(candidate.supports({ query }).supported, true);
  assert.match(candidate.supports({ query, inputKind: 'controlled-fixture' }).reason, /fixture/i);
  assert.equal(candidate.supports({ query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 45 }] } }).supported, false);
});

test('equivalent mapping metadata remains valid when OpenSearch changes object key order', async () => {
  const candidate = await createCandidate({ config, context }, { api: backend({ mutate: (_, mapping) => {
    const linked = mapping._meta.linkedStrictness;
    mapping._meta.linkedStrictness = { percentageStep: linked.percentageStep, presets: linked.presets.map(value =>
      ({ cutoffBlendExponent: value.cutoffBlendExponent, qualityInfluence: value.qualityInfluence })), bankId: linked.bankId };
  } }), sourceFiles: async () => [] });
  assert.equal((await candidate.prepare()).completeIdsVerified, true);
});

test('feedback preparation rejects missing/foreign fields, wrong preset path and incomplete corpus', async () => {
  for (const mutate of [
    (_, mapping) => { delete mapping.properties.utilities.properties[Object.keys(mapping.properties.utilities.properties)[0]]; },
    (_, mapping) => { mapping._meta.linkedStrictness.presets[0].qualityInfluence = .5; },
    (_, mapping) => { mapping.properties.id.doc_values = false; },
    (_, mapping) => { mapping._source.enabled = true; },
    bodies => { bodies[linkedStrictnessBank('linked-3').index + '/_mget?_source=false'].docs[0]._id = 'wrong'; },
  ]) {
    const candidate = await createCandidate({ config, context }, { api: backend({ mutate }), sourceFiles: async () => [] });
    await assert.rejects(candidate.prepare());
  }
});

test('linked feedback sends fixtures and case eligibility to OpenSearch and preserves returned order exactly', async () => {
  let captured;
  const hits = [{ id: 'b', score: .75 }, { id: 'a', score: .5 }];
  const candidate = await createCandidate({ config, context }, { sourceFiles: async () => [], searchService: async options => {
    captured = options; return { hits, evidence: { serviceTookMs: 2 } };
  } });
  const controller = new AbortController();
  const result = await candidate.search({ caseData: { query, eligibleIds: ['a', 'b'], excludedIds: ['not-city'] }, limit: 1000, signal: controller.signal });
  assert.equal(captured.index, linkedStrictnessBank('linked-3').index); assert.equal(captured.parameters.qualityInfluence, .5);
  assert.deepEqual(captured.eligibleIds, ['a', 'b']); assert.deepEqual(captured.excludedIds, ['fixture', 'not-city']);
  assert.equal(captured.signal, controller.signal); assert.equal(result.hits, hits); assert.equal(result.evidence.realImagesOnly, true);
  await assert.rejects(candidate.search({ caseData: { query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 45 }] } }, limit: 20 }), /5|10/);
});

test('matched original reference keeps parent scoring and explicitly shares the10% real-image evaluation scope', async () => {
  let parentConfig, searched;
  const candidate = await createCandidate({ config: { ...config, id: 'original-test', variant: 'original' }, context }, {
    sourceFiles: async () => [], createOriginal: async ({ config: originalConfig }) => { parentConfig = originalConfig; return {
      metadata: { sourceFiles: [], limitations: [] }, supports: () => ({ supported: true }), prepare: async () => ({ count: 3, completeIdsVerified: true }),
      search: async options => { searched = options; return { hits: [{ id: 'a', score: .5 }] }; },
    }; },
  });
  assert.equal(parentConfig.method, 'cutoff-shade-hue-all-levels'); assert.equal(parentConfig.parameters.cutoffBlendExponent, 1);
  const intermediate = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 45 }] };
  assert.equal(candidate.supports({ query: intermediate }).supported, false);
  assert.match(candidate.supports({ query: intermediate }).reason, /comparison|shared/i);
  assert.equal(candidate.supports({ query, inputKind: 'controlled-fixture' }).supported, false);
  await candidate.search({ caseData: { query, excludedIds: ['other'] }, limit: 20 });
  assert.deepEqual(searched.caseData.excludedIds, ['fixture', 'other']);
  assert.equal((await candidate.prepare()).searchableRealCount, 2);
});

test('fixture leakage fails rather than application-filtering returned hits', async () => {
  const candidate = await createCandidate({ config, context }, { sourceFiles: async () => [], searchService: async () => ({ hits: [{ id: 'fixture', score: 1 }] }) });
  await assert.rejects(candidate.search({ caseData: { query }, limit: 20 }), /fixture|ineligible/i);
});
