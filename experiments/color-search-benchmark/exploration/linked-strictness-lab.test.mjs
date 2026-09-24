import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { validateLinkedStrictnessRequest, createLinkedStrictnessLabProvider } from './linked-strictness-lab.mjs';
import { createFavoriteLabServer, stopFavoriteLab } from './favorite-lab.mjs';
import { createLinkedStrictnessPlan } from './linked-strictness.mjs';
import { strictnessQueryError, strictnessPercentAdjustment } from './web/favorite-lab/strictness.js';

const query = { mode: 'proportions', targets: [{ name: 'grayscale', percent: 80 }, { color: '#ff0000', percent: 20 }] };
const corpus = [{ id: 'a', filename: '/unused/a.jpg', cohort: 'prior-wallpaper' },
  { id: 'b', filename: '/unused/b.jpg', cohort: 'wallpapermadness' },
  { id: 'fixture', filename: '/unused/fixture.svg', cohort: 'controlled-fixture' }];

test('copying percentage queries proposes valid adjustments without changing the original query', () => {
  for (const [amounts, expected] of [[[45, 55], [50, 50]], [[45, 45], [50, 40]], [[5], [10]]]) {
    const input = { mode: 'proportions', targets: amounts.map((percent, i) => ({ color: i ? '#00ff00' : '#ff0000', percent })) };
    const before = structuredClone(input);
    assert.equal(strictnessQueryError(input, 5), '');
    assert.notEqual(strictnessQueryError(input, 10), '');
    const proposal = strictnessPercentAdjustment(input);
    assert.deepEqual(proposal.targets.map(target => target.percent), expected);
    assert.equal(strictnessQueryError(proposal, 10), '');
    assert.deepEqual(input, before);
  }
  assert.throws(() => strictnessPercentAdjustment({ mode: 'proportions', targets: [{ color: '#ff0000', percent: 105 }] }));
});

test('linked controls preserve favorite pairs and reject hidden overrides or unsupported percentages', () => {
  for (const [steps, level] of [[3, 1], [5, 2]]) {
    const selected = validateLinkedStrictnessRequest({ variant: 'linked', steps, level, query, limit: 523 });
    assert.equal(selected.parameters.qualityInfluence, .5);
    assert.equal(selected.parameters.cutoffBlendExponent, 1);
    assert.equal(selected.limit, 523);
  }
  for (const patch of [{ level: 5 }, { steps: 4 }, { parameters: { qualityInfluence: 1 } }, { index: 'production' },
    { query: { mode: 'proportions', targets: [{ color: '#00ff00', percent: 45 }] } }, { limit: 524 }]) {
    assert.throws(() => validateLinkedStrictnessRequest({ variant: 'linked', steps: 5, level: 2, query, ...patch }));
  }
  const original = validateLinkedStrictnessRequest({ variant: 'original', query: { mode: 'proportions', targets: [{ color: '#00ff00', percent: 45 }] },
    parameters: { qualityInfluence: .5, cutoffBlendExponent: 3 } });
  assert.equal(original.parameters.cutoffBlendExponent, 3);
  assert.throws(() => validateLinkedStrictnessRequest({ variant: 'original', query, parameters: { qualityCurve: 'power' } }));
});

test('original provider delegates unchanged query and never runs compact search', async () => {
  const calls = [];
  const provider = await createLinkedStrictnessLabProvider({ corpus, originalSearch: async input => {
    calls.push(input); return { supported: true, hits: [{ id: 'b', score: .8 }, { id: 'a', score: .7 }] };
  }, readIndexState: async () => assert.fail('Original must not depend on compact index'),
    searchService: async () => assert.fail('Original must use original scorer') });
  const input = validateLinkedStrictnessRequest({ variant: 'original', query });
  const result = await provider.searchStrictness(input);
  assert.deepEqual(result.hits.map(hit => hit.id), ['b', 'a']);
  assert.equal(calls[0].methodId, 'cutoff-shade-hue-all-levels');
  assert.deepEqual(calls[0].query, query);
});

test('compact provider fails closed when the selected index is unavailable', async () => {
  const provider = await createLinkedStrictnessLabProvider({ corpus, originalSearch: async () => ({}),
    readIndexState: async () => { throw Error('missing index'); }, searchService: async () => assert.fail('Must validate index first') });
  const meta = await provider.getStrictness();
  assert.equal(meta.wallpaperCount, 2);
  assert.equal(meta.banks.length, 2);
  assert.ok(meta.banks.every(bank => !bank.available));
  await assert.rejects(provider.searchStrictness(validateLinkedStrictnessRequest({ variant: 'linked', steps: 3, level: 1, query })), /missing index/);
});

test('compact provider verifies complete fields/corpus, excludes fixtures in the service and preserves order', async () => {
  const plan = createLinkedStrictnessPlan('linked-3');
  const fields = Object.fromEntries(plan.descriptors.map(item => [item.key, { type: 'float', index: true, doc_values: true }]));
  let generation = 1, extra = false, called = 0;
  const provider = await createLinkedStrictnessLabProvider({ corpus, originalSearch: async () => assert.fail('Linked must use compact service'),
    readIndexState: async () => ({ uuid: 'compact-index', generationToken: String(generation), documentCount: extra ? 4 : 3,
      metadata: { experiment: 'strict-hue-favorite-utilities', utilityDefinitionVersion: 2, mode: 'real', scope: 'full', count: 3,
        presets: 'linked', numericPoints: true, encodings: ['numeric'], identityHash: 'identity', planHash: 'plan',
        linkedStrictness: { bankId: 'linked-3', percentageStep: 10 } },
      sourceEnabled: false, idField: { type: 'keyword' }, numericUtilityFields: fields }),
    request: async (_route, options) => { assert.deepEqual(options.body.ids, ['a', 'b', 'fixture']); return { body: { docs: corpus.map(asset => ({ _id: asset.id, found: true })) } }; },
    searchService: async input => { called++; assert.deepEqual(input.excludedIds, ['fixture']);
      assert.equal(input.index, 'color-exploration-favorite-linked-3-real-v1');
      assert.equal(input.parameters.qualityInfluence, .5);
      return { hits: [{ id: 'b', score: .8 }, { id: 'a', score: .7 }], evidence: { serviceTookMs: 3 } };
    } });
  const input = validateLinkedStrictnessRequest({ variant: 'linked', steps: 3, level: 1, query });
  const result = await provider.searchStrictness(input);
  assert.deepEqual(result.hits.map(hit => hit.id), ['b', 'a']);
  assert.equal(result.evidence.utilityFields, 10044);
  extra = true; generation++;
  await assert.rejects(provider.searchStrictness(input), /every corpus/);
  assert.equal(called, 1);
  extra = false; generation++; delete fields[Object.keys(fields)[0]];
  await assert.rejects(provider.searchStrictness(input), /score fields/);
  assert.equal(called, 1);
});

test('strictness HTTP routes preserve service order and reject fixture hits', async () => {
  let bad = false;
  const server = createFavoriteLabServer({ corpus, search: async () => ({ hits: [] }),
    getStrictness: async () => ({ wallpaperCount: 2, banks: [] }),
    searchStrictness: async input => ({ supported: true, parameters: input.parameters,
      hits: bad ? [{ id: 'fixture', score: 1 }] : [{ id: 'b', score: .8 }, { id: 'a', score: .7 }] }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/strictness').then(r => r.json())).wallpaperCount, 2);
    const request = () => fetch(base + '/api/strictness/search', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant: 'linked', steps: 5, level: 2, query }) });
    const first = await request(); assert.equal(first.status, 200);
    const result = await first.json();
    assert.deepEqual(result.hits.map(hit => hit.id), ['b', 'a']);
    assert.equal(result.hits[0].imageUrl, '/api/images/b');
    bad = true; assert.equal((await request()).status, 502);
    assert.equal((await fetch(base + '/api/meta').then(r => r.json())).methods.length, 19);
  } finally { await stopFavoriteLab(server, { closeTransports: async () => {} }); }
});
