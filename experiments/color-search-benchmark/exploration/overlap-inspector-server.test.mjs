import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createOverlapInspectorServer } from './overlap-inspector-server.mjs';

const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 40 }] };
const methods = [{ id: 'overlap-quality-dense', label: 'Dense' }, { id: 'overlap-quality-hybrid', label: 'Hybrid' }];
const defaultParameters = { areaPower: .5, qualityPenalty: .35, excessPenalty: 1.5, qualityInfluence: 1, qualityCurve: 'linear', minimumQuality: 0, bucketCount: 1024 };
async function fixture(t, overrides = {}) {
  const calls = [];
  const server = createOverlapInspectorServer({
    methods,
    corpus: [{ id: 'a', filename: '/unused.jpg', cohort: 'real' }, { id: 'b', filename: '/unused.svg', cohort: 'controlled-fixture' }],
    search: async request => { calls.push(['search', request]); return { hits: [{ id: 'b', score: .8 }, { id: 'a', score: .6 }] }; },
    inspect: async request => { calls.push(['inspect', request]); return { id: request.id, score: { actual: .8 }, regions: [{ index: 0, coverage: 1 }] }; },
    ...overrides,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { origin, post, calls };
}

test('search preserves service order, method selection, and the executed query', async t => {
  const { post, calls } = await fixture(t);
  const response = await post('/api/search', { methodId: methods[1].id, query, limit: 12, includeFixtures: true });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.hits.map(hit => hit.id), ['b', 'a']);
  assert.deepEqual(data.query, query);
  assert.equal(data.methodId, methods[1].id);
  assert.equal(data.hits[0].imageUrl, '/api/images/b');
  assert.equal(calls[0][1].method, methods[1].id);
  assert.equal(calls[0][1].includeFixtures, true);
  assert.ok(calls[0][1].signal instanceof AbortSignal);
});

test('inspection forwards the exact saved query, selected method, and registered wallpaper', async t => {
  const { post, calls } = await fixture(t);
  const response = await post('/api/inspect', { methodId: methods[1].id, id: 'a', query });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.score.actual, .8);
  assert.equal(data.regions[0].coverage, 1);
  assert.equal(data.imageUrl, '/api/images/a');
  assert.deepEqual(calls[0][1].query, query);
  assert.equal(calls[0][1].method, methods[1].id);
  assert.equal((await post('/api/inspect', { id: '../secret', query })).status, 404);
  assert.equal(calls.length, 1);
});

test('search snapshots normalized tuning and inspection replays those saved parameters', async t => {
  const { post, calls } = await fixture(t);
  for (const tuning of [
    { qualityInfluence: 2.4, minimumQuality: .67, bucketCount: 16 },
    { qualityInfluence: 0, minimumQuality: .85, bucketCount: 64 },
    { qualityInfluence: 3, minimumQuality: 1, bucketCount: 256 },
    { qualityInfluence: 1, minimumQuality: 0, bucketCount: 1024 },
  ]) {
    const tuned = { ...tuning, qualityCurve: tuning.qualityInfluence > 1 ? 'power' : 'linear', areaPower: 1, qualityPenalty: .6, excessPenalty: 2 };
    const searched = await post('/api/search', { query, parameters: tuned });
    assert.equal(searched.status, 200);
    const saved = await searched.json();
    assert.deepEqual(saved.parameters, tuned);
    assert.deepEqual(calls.at(-1)[1].parameters, tuned);

    const inspected = await post('/api/inspect', { id: 'a', query: saved.query, methodId: saved.methodId, parameters: saved.parameters });
    assert.equal(inspected.status, 200);
    assert.deepEqual((await inspected.json()).parameters, saved.parameters);
    assert.deepEqual(calls.at(-1)[1].parameters, calls.at(-2)[1].parameters);
  }
});

test('old clients retain defaults while tuning accepts its boundaries and all four bucket counts', async t => {
  const { post, calls } = await fixture(t);
  for (const route of ['/api/search', '/api/inspect']) {
    const response = await post(route, { id: 'a', query });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).parameters, defaultParameters);
    assert.deepEqual(calls.at(-1)[1].parameters, defaultParameters);
    for (const tuning of [
      { qualityInfluence: 0 }, { qualityInfluence: 3 },
      { qualityCurve: 'linear' }, { qualityCurve: 'power', qualityInfluence: 3 },
      { minimumQuality: 0 }, { minimumQuality: 1 },
      { qualityInfluence: 0, minimumQuality: 1 },
      { bucketCount: 16 }, { bucketCount: 64 }, { bucketCount: 256 }, { bucketCount: 1024 },
    ]) {
      const changed = await post(route, { id: 'a', query, parameters: tuning });
      assert.equal(changed.status, 200);
      assert.deepEqual((await changed.json()).parameters, { ...defaultParameters, ...tuning });
      assert.deepEqual(calls.at(-1)[1].parameters, { ...defaultParameters, ...tuning });
    }
  }
});

test('selected bucket count survives search and inspection with noncontiguous anchor IDs', async t => {
  const selectedRegions = [{ index: 0, coverage: 0 }, { index: 631, coverage: .8 }];
  const { post, calls } = await fixture(t, {
    inspect: async request => {
      calls.push(['inspect', request]);
      return { score: { actual: .6 }, regions: selectedRegions, evidence: { index: 'color-exploration-overlap-16-real-v1' } };
    },
  });
  const searched = await post('/api/search', { query, methodId: methods[1].id, parameters: { bucketCount: 16, minimumQuality: .7 } });
  assert.equal(searched.status, 200);
  const saved = await searched.json();
  assert.equal(saved.parameters.bucketCount, 16);
  const inspected = await post('/api/inspect', { id: 'a', methodId: saved.methodId, query: saved.query, parameters: saved.parameters });
  assert.equal(inspected.status, 200);
  const diagnosis = await inspected.json();
  assert.deepEqual(diagnosis.regions, selectedRegions);
  assert.equal(diagnosis.parameters.bucketCount, 16);
  assert.equal(diagnosis.evidence.index, 'color-exploration-overlap-16-real-v1');
  assert.deepEqual(calls.at(-1)[1].parameters, calls.at(-2)[1].parameters);
  assert.equal(calls.at(-1)[1].method, methods[1].id);
});

test('the response preserves effective parameters reported by the service', async t => {
  const effective = { ...defaultParameters, qualityInfluence: 2, minimumQuality: .7 };
  const { post } = await fixture(t, {
    search: async () => ({ hits: [{ id: 'a', score: .6 }], parameters: effective }),
    inspect: async () => ({ score: { actual: .6 }, parameters: effective }),
  });
  for (const route of ['/api/search', '/api/inspect']) {
    const response = await post(route, { id: 'a', query, parameters: { qualityInfluence: 2.4, minimumQuality: .6 } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).parameters, effective);
  }
});

test('malformed and out-of-range tuning never reaches either service', async t => {
  const { post, calls } = await fixture(t);
  const invalid = [
    null, [], 1, '1', false,
    { unknown: 1 }, { qualityInfluence: -0.01 }, { qualityInfluence: 3.01 },
    { qualityInfluence: '1' }, { qualityInfluence: null }, { qualityInfluence: false },
    { qualityCurve: 'unknown' }, { qualityCurve: null }, { qualityCurve: 1 }, { qualityCurve: [] },
    { minimumQuality: -0.001 }, { minimumQuality: 1.001 }, { minimumQuality: 70 },
    { minimumQuality: '0.7' }, { minimumQuality: null }, { minimumQuality: false },
    { minimumQuality: [] }, { minimumQuality: {} },
    { bucketCount: 0 }, { bucketCount: 15 }, { bucketCount: 17 }, { bucketCount: 63 }, { bucketCount: 65 },
    { bucketCount: 255 }, { bucketCount: 257 }, { bucketCount: 1023 }, { bucketCount: 1025 },
    { bucketCount: 16.5 }, { bucketCount: '16' }, { bucketCount: null }, { bucketCount: false },
    { bucketCount: [] }, { bucketCount: {} },
    { areaPower: .75 }, { qualityPenalty: -1 }, { qualityPenalty: 2 }, { excessPenalty: .5 }, { excessPenalty: 5 },
  ];
  for (const route of ['/api/search', '/api/inspect']) {
    for (const parameters of invalid) {
      const response = await post(route, { id: 'a', query, parameters });
      assert.equal(response.status, 400, `${route}: ${JSON.stringify(parameters)}`);
      assert.match((await response.json()).error, /parameter|qualityInfluence|qualityCurve|minimumQuality|areaPower|qualityPenalty|excessPenalty|bucket.?count/i);
    }
  }
  assert.equal(calls.length, 0);
});

test('invalid controls and unknown methods never reach a search service', async t => {
  const { post, calls } = await fixture(t);
  for (const body of [
    { query, methodId: 'not-this-prototype' }, { query, limit: 101 }, { query, includeFixtures: 'yes' },
    { query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 120 }] } },
    { query: { ...query, unsupported: true } },
  ]) assert.equal((await post('/api/search', body)).status, 400);
  assert.equal(calls.length, 0);
});

test('configuration and static resources are isolated from other inspectors', async t => {
  const { origin } = await fixture(t);
  const data = await (await fetch(origin + '/api/config')).json();
  assert.deepEqual(data.methods, methods);
  assert.deepEqual(data.corpus, { total: 2, real: 1, fixtures: 1 });
  assert.deepEqual(data.bucketCounts, [16, 64, 256, 1024]);
  assert.equal(data.defaultBucketCount, 1024);
  assert.ok(!JSON.stringify(data).includes('/unused'));
  assert.equal((await fetch(origin + '/api/images/unknown')).status, 404);
  assert.equal((await fetch(origin + '/assets/histogram-inspector.js')).status, 404);
  const layerModule = await fetch(origin + '/assets/overlap-color-layers.mjs');
  assert.equal(layerModule.status, 200);
  assert.match(layerModule.headers.get('content-type'), /javascript/);
  assert.match(await layerModule.text(), /export function colorLayerRequest/);
  const page = await fetch(origin + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Overlapping color regions/);
});

test('invalid service results fail instead of being locally filtered', async t => {
  for (const hits of [[{ id: 'foreign', score: 1 }], [{ id: 'a', score: 1 }, { id: 'a', score: .5 }]]) {
    const { post } = await fixture(t, { search: async () => ({ hits }) });
    assert.equal((await post('/api/search', { query })).status, 502);
  }
});

test('region color examples are a read-only geometry endpoint independent of wallpaper queries', async t => {
  const { origin, calls } = await fixture(t);
  const result = await fetch(origin + '/api/region-colors?regionIndex=0&bucketCount=16');
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.region.index, 0);
  assert.equal(data.region.hex, '#000000');
  assert.equal(data.definition.anchorCount, 16);
  assert.ok(data.samples.length > 5);
  assert.equal(data.samples.filter(sample => sample.isAnchor).length, 1);
  const defaults = await (await fetch(origin + '/api/region-colors?regionIndex=0')).json();
  assert.equal(defaults.definition.anchorCount, 1024);
  assert.deepEqual(defaults.samples, data.samples);
  assert.deepEqual(calls, []);
});

test('region color endpoint rejects malformed arguments and regions absent from the selected bank', async t => {
  const { origin, calls } = await fixture(t);
  for (const queryString of [
    '', '?regionIndex=', '?regionIndex=NaN', '?regionIndex=-1', '?regionIndex=1.5', '?regionIndex=1024',
    '?regionIndex=0&bucketCount=', '?regionIndex=0&bucketCount=17', '?regionIndex=0&bucketCount=16.5',
    '?regionIndex=0&regionIndex=1', '?regionIndex=0&bucketCount=16&bucketCount=64', '?regionIndex=0&other=1',
    '?regionIndex=8&bucketCount=16',
  ]) {
    const response = await fetch(origin + '/api/region-colors' + queryString);
    assert.equal(response.status, 400, queryString);
    assert.match((await response.json()).error, /region|bucket|parameter/i);
  }
  assert.equal((await fetch(origin + '/api/region-colors?regionIndex=0', { method: 'POST' })).status, 405);
  assert.deepEqual(calls, []);
});

test('shade-aware color endpoints preserve metric for combined and individual layers', async t => {
  const { origin } = await fixture(t);
  const combined = await fetch(origin + '/api/region-colors?regionIndex=4&bucketCount=16&metric=shade-aware&profile=all-levels&cutoffBlendExponent=4.3');
  assert.equal(combined.status, 200);
  const data = await combined.json();
  assert.equal(data.definition.metric, 'shade-aware');
  assert.equal(data.definition.cutoffBlendExponent, 4.3);
  assert.equal(data.definition.components.length, 5);
  const single = await fetch(origin + '/api/region-colors?regionIndex=4&metric=shade-aware&profile=hard&cutoff=.5');
  assert.equal(single.status, 200);
  const layer = await single.json();
  assert.equal(layer.definition.metric, 'shade-aware');
  assert.equal(layer.definition.cutoff, .5);
  assert.ok(layer.contextPlanes.lightness.find(sample => sample.hex === '#800000').matches);
  for (const args of ['metric=bad&profile=hard', 'metric=shade-aware', 'metric=shade-aware&profile=feather', 'metric=shade-aware&metric=shade-aware&profile=hard']) {
    const response = await fetch(origin + '/api/region-colors?regionIndex=4&' + args);
    assert.equal(response.status, 400);
  }
});

test('shade-aware searches and inspections retain all-cutoff controls', async t => {
  const method = 'cutoff-shade-all-levels';
  const { post, calls } = await fixture(t, { methods: [...methods, { id: method, label: 'All cutoffs: shade-aware' }] });
  const parameters = { bucketCount: 64, cutoffBlendExponent: 2.3, qualityCurve: 'power', qualityInfluence: 3, minimumQuality: .2 };
  const searched = await post('/api/search', { methodId: method, query, parameters });
  assert.equal(searched.status, 200);
  const saved = await searched.json();
  assert.equal(saved.methodId, method);
  assert.equal(saved.parameters.pixelCutoff, 0);
  assert.equal(saved.parameters.cutoffBlendExponent, 2.3);
  const inspected = await post('/api/inspect', { methodId: method, id: 'a', query: saved.query, parameters: saved.parameters });
  assert.equal(inspected.status, 200);
  assert.deepEqual(calls[0][1].parameters, calls[1][1].parameters);
});

test('strict-hue color endpoints route their own combined and individual geometry', async t => {
  const { origin } = await fixture(t);
  const combined = await fetch(origin + '/api/region-colors?regionIndex=4&bucketCount=16&metric=shade-hue-aware&profile=all-levels&cutoffBlendExponent=4.3');
  assert.equal(combined.status, 200);
  const data = await combined.json();
  assert.equal(data.definition.metric, 'shade-hue-aware');
  assert.equal(data.definition.cutoffBlendExponent, 4.3);
  assert.equal(data.definition.components.length, 5);
  const single = await fetch(origin + '/api/region-colors?regionIndex=4&metric=shade-hue-aware&profile=hard&cutoff=.5');
  assert.equal(single.status, 200);
  const layer = await single.json();
  assert.equal(layer.definition.metric, 'shade-hue-aware');
  assert.ok(layer.contextPlanes.lightness.find(sample => sample.hex === '#800000').matches);
  assert.equal((await fetch(origin + '/api/region-colors?regionIndex=4&metric=shade-hue-aware&profile=feather')).status, 400);
});

test('strict-hue searches preserve method identity and all-cutoff controls', async t => {
  const method = 'cutoff-shade-hue-all-levels';
  const { post, calls } = await fixture(t, { methods: [...methods, { id: method, label: 'All cutoffs: shade-aware + strict hue' }] });
  const searched = await post('/api/search', { methodId: method, query, parameters: { bucketCount: 16, cutoffBlendExponent: 2.3, qualityInfluence: 1 } });
  assert.equal(searched.status, 200);
  const saved = await searched.json();
  assert.equal(saved.methodId, method);
  assert.equal(saved.parameters.pixelCutoff, 0);
  assert.equal(saved.parameters.cutoffBlendExponent, 2.3);
  const inspected = await post('/api/inspect', { methodId: method, id: 'a', query: saved.query, parameters: saved.parameters });
  assert.equal(inspected.status, 200);
  assert.deepEqual(calls[0][1].parameters, calls[1][1].parameters);
});
