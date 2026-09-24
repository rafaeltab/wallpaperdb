import test from 'node:test';
import assert from 'node:assert/strict';
import { getMethod, indexForMethod, executeSearch } from './registry.mjs';
import { buildCutoffQuery, supportsCutoff } from './methods-cutoff.mjs';
import { createCandidate } from './adapter.mjs';
import { inspectCutoff } from './cutoff-diagnostics.mjs';

const method = 'cutoff-shade-hue-all-levels';
const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
test('strict hue keeps query mechanics and uses its own measured indexes', () => {
  assert.equal(getMethod(method).metric, 'shade-hue-aware');
  for (const bucketCount of [16, 64, 256, 1024]) for (const cutoffBlendExponent of [0, 3, 6]) for (const qualityInfluence of [1, 3]) {
    const parameters = { bucketCount, cutoffBlendExponent, qualityInfluence, qualityCurve: 'power', minimumQuality: .3 };
    assert.deepEqual(buildCutoffQuery({ method, query, parameters }), buildCutoffQuery({ method: 'cutoff-shade-all-levels', query, parameters }));
    assert.equal(indexForMethod(method, undefined, parameters), `color-exploration-shade-hue-${bucketCount}-real-v1`);
    assert.equal(indexForMethod('cutoff-shade-all-levels', undefined, parameters), `color-exploration-shade-${bucketCount}-real-v1`);
    assert.equal(indexForMethod(method, 'explicit-scratch-index', parameters), 'explicit-scratch-index');
  }
  assert.equal(supportsCutoff(method, { targets: [{ color: '#ff0000', distance: .24 }] }).supported, false);
  assert.ok(supportsCutoff(method, query).warnings.some(warning => warning.includes('hue')));
});

test('strict hue feedback verifies measured hue geometry before execution', async () => {
  for (const bucketCount of [16, 64, 256, 1024]) {
    const calls = [];
    const candidate = await createCandidate({ config: { id: method, parameters: { bucketCount } }, context: { corpus: [{ id: 'one' }] } }, {
      verifyHueIndex: async request => { calls.push(request); return { count: 1, completeIdsVerified: true, allValuesVerified: true, metricDefinitionVerified: true }; },
      verifyShadeIndex: () => { throw Error('Wrong extraction verifier'); },
      verifyCutoffIndex: () => { throw Error('Wrong extraction verifier'); },
      api: async endpoint => ({ body: endpoint.startsWith('_nodes') ? { nodes: { one: { jvm: { mem: { heap_max_in_bytes: 2147483648 } } } } } : { version: { number: 'test' } } }),
      executeSearch: async request => { calls.push(request); return { hits: [{ id: 'one', score: .1 }], evidence: {} }; },
    });
    const prepared = await candidate.prepare();
    await candidate.search({ caseData: { query }, limit: 1 });
    assert.ok(calls.every(call => call.index === `color-exploration-shade-hue-${bucketCount}-real-v1`));
    assert.equal(prepared.metricDefinitionVerified, true);
    assert.equal(prepared.hard50ParityVerified, undefined);
    assert.equal(candidate.metadata.metric, 'shade-hue-aware');
    assert.equal(candidate.metadata.representation, `shade-hue-coverage-quality-${bucketCount}`);
    assert.ok(candidate.metadata.sourceFiles.includes('exploration/hue-definition.mjs'));
  }
});

test('real hue prototype reproduces the user preference across banks and scoring controls', { skip: process.env.COLOR_HUE_INTEGRATION !== '1' }, async () => {
  for (const bucketCount of [16, 64, 256, 1024]) for (const qualityInfluence of [1, 3]) for (const cutoffBlendExponent of [0, 3, 6]) {
    const parameters = { bucketCount, qualityInfluence, qualityCurve: 'power', cutoffBlendExponent };
    const result = await executeSearch({ method, query, parameters, limit: 545 });
    assert.equal(result.hits.length, 545);
    const preferred = result.hits.find(hit => hit.id === 'madness-wallhaven-ogg7ql');
    const other = result.hits.find(hit => hit.id === 'wallpaper-031');
    assert.ok(preferred.score > other.score, `${JSON.stringify(parameters)}: pagoda must outrank orange sky`);
    if (cutoffBlendExponent === 0) {
      const inspected = await inspectCutoff({ method, query, parameters, id: preferred.id });
      assert.equal(inspected.definition.metric, 'shade-hue-aware');
      assert.equal(inspected.score.actual, preferred.score);
      assert.ok(Math.abs(inspected.score.difference) < 1e-6);
      assert.equal(inspected.regions.length, bucketCount);
    }
  }
});
