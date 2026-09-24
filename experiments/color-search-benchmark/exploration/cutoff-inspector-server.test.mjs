import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createOverlapInspectorServer } from './overlap-inspector-server.mjs';
import { CUTOFF_METHODS } from './methods-cutoff.mjs';

test('cutoff inspector snapshots every profile, bank and closeness level', async t => {
  const calls = [];
  const server = createOverlapInspectorServer({
    corpus: [{ id: 'wallpaper', filename: '/unused.jpg', cohort: 'real' }], methods: CUTOFF_METHODS,
    search: async request => { calls.push(request); return { hits: [{ id: 'wallpaper', score: .75 }] }; },
    inspect: async request => { calls.push(request); return { score: { actual: .75 } }; },
    regionColors: async request => { calls.push(request); return { parameters: request }; },
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
  const post = (route, body) => fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  for (const method of CUTOFF_METHODS.filter(method => method.profile !== 'all-levels')) for (const bucketCount of [16, 64, 256, 1024]) for (const pixelCutoff of [0, .25, .5, .75, .9]) {
    const parameters = { bucketCount, pixelCutoff, namedMode: 'named-families', qualityCurve: pixelCutoff < .5 ? 'power' : 'linear', qualityInfluence: 2.4, minimumQuality: .63 };
    const searched = await post('/api/search', { query, methodId: method.id, parameters });
    assert.equal(searched.status, 200); const saved = await searched.json();
    for (const [key, value] of Object.entries(parameters)) assert.equal(saved.parameters[key], value);
    const inspected = await post('/api/inspect', { query: saved.query, methodId: saved.methodId, parameters: saved.parameters, id: 'wallpaper' });
    assert.equal(inspected.status, 200);
    assert.deepEqual((await inspected.json()).parameters, saved.parameters);
    assert.deepEqual(calls.at(-1).parameters, calls.at(-2).parameters);
    const colors = await fetch(`${origin}/api/region-colors?regionIndex=0&bucketCount=${bucketCount}&profile=${method.profile}&cutoff=${pixelCutoff}`);
    assert.equal(colors.status, 200);
    assert.deepEqual((await colors.json()).parameters, { regionIndex: 0, bucketCount, profile: method.profile, cutoff: pixelCutoff });
  }
  const before = calls.length;
  for (const parameters of [{ pixelCutoff: .51 }, { pixelCutoff: '0.5' }, { namedMode: 'anything' }, { pixelCutoff: null }, { qualityCurve: 'unknown' }, { qualityCurve: null }]) {
    assert.equal((await post('/api/search', { query, methodId: 'cutoff-feather', parameters })).status, 400);
  }
  for (const suffix of ['cutoff=.5', 'profile=unknown', 'profile=hard&cutoff=', 'profile=hard&cutoff=.6', 'profile=hard&cutoff=.5&cutoff=.75']) {
    assert.equal((await fetch(`${origin}/api/region-colors?regionIndex=0&${suffix}`)).status, 400);
  }
  assert.equal(calls.length, before);
});

test('all-level inspector preserves blend weights across search, inspection and color samples', async t => {
  const calls = [];
  const server = createOverlapInspectorServer({
    corpus: [{ id: 'wallpaper', filename: '/unused.jpg', cohort: 'real' }], methods: CUTOFF_METHODS,
    search: async request => { calls.push(request); return { hits: [{ id: 'wallpaper', score: .75 }] }; },
    inspect: async request => { calls.push(request); return { score: { actual: .75 } }; },
    regionColors: async request => { calls.push(request); return { parameters: request }; },
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
  const post = (route, body) => fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const config = await (await fetch(origin + '/api/config')).json();
  assert.ok(config.cutoffProfiles.some(profile => profile.id === 'all-levels'));
  for (const bucketCount of [16, 64, 256, 1024]) for (const cutoffBlendExponent of [0, 2.5, 6]) {
    const searched = await post('/api/search', { query, methodId: 'cutoff-all-levels', parameters: { bucketCount, cutoffBlendExponent, pixelCutoff: .75 } });
    assert.equal(searched.status, 200); const saved = await searched.json();
    assert.equal(saved.parameters.cutoffBlendExponent, cutoffBlendExponent);
    assert.equal(saved.parameters.pixelCutoff, 0);
    const inspected = await post('/api/inspect', { query: saved.query, methodId: saved.methodId, parameters: saved.parameters, id: 'wallpaper' });
    assert.equal(inspected.status, 200);
    assert.deepEqual((await inspected.json()).parameters, saved.parameters);
    assert.deepEqual(calls.at(-1).parameters, calls.at(-2).parameters);
    const colors = await fetch(`${origin}/api/region-colors?regionIndex=0&bucketCount=${bucketCount}&profile=all-levels&cutoff=0&cutoffBlendExponent=${cutoffBlendExponent}`);
    assert.equal(colors.status, 200);
    assert.deepEqual((await colors.json()).parameters, { regionIndex: 0, bucketCount, profile: 'all-levels', cutoff: 0, cutoffBlendExponent });
  }
  const before = calls.length;
  for (const cutoffBlendExponent of [-1, 6.1, '2', null]) assert.equal((await post('/api/search', { query, methodId: 'cutoff-all-levels', parameters: { cutoffBlendExponent } })).status, 400);
  for (const suffix of ['profile=all-levels&cutoffBlendExponent=', 'profile=all-levels&cutoffBlendExponent=-1', 'profile=all-levels&cutoffBlendExponent=7', 'profile=all-levels&cutoffBlendExponent=NaN', 'profile=all-levels&cutoffBlendExponent=2&cutoffBlendExponent=3', 'profile=hard&cutoffBlendExponent=2', 'cutoffBlendExponent=0']) {
    assert.equal((await fetch(`${origin}/api/region-colors?regionIndex=0&${suffix}`)).status, 400);
  }
  assert.equal(calls.length, before);
});
