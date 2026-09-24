import test from 'node:test';
import assert from 'node:assert/strict';
import { getMethod, indexForMethod, executeSearch } from './registry.mjs';
import { buildCutoffQuery, supportsCutoff } from './methods-cutoff.mjs';
import { createCandidate } from './adapter.mjs';
import { inspectCutoff } from './cutoff-diagnostics.mjs';

const method = 'cutoff-shade-all-levels';
const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
test('shade variant preserves ranking controls and query work, using separate measured indexes', () => {
  assert.equal(getMethod(method).metric, 'shade-aware');
  for (const bucketCount of [16, 64, 256, 1024]) for (const cutoffBlendExponent of [0, 3, 6]) for (const qualityInfluence of [1, 3]) {
    const parameters = { bucketCount, cutoffBlendExponent, qualityInfluence, qualityCurve: 'power', minimumQuality: .3 };
    assert.deepEqual(buildCutoffQuery({ method, query, parameters }), buildCutoffQuery({ method: 'cutoff-all-levels', query, parameters }));
    assert.equal(indexForMethod(method, undefined, parameters), `color-exploration-shade-${bucketCount}-real-v1`);
    assert.equal(indexForMethod('cutoff-all-levels', undefined, parameters), `color-exploration-cutoff-${bucketCount}-real-v1`);
    assert.equal(indexForMethod(method, 'explicit-scratch-index', parameters), 'explicit-scratch-index');
  }
  assert.equal(supportsCutoff(method, { targets: [{ color: '#ff0000', distance: .24 }] }).supported, false);
  assert.ok(supportsCutoff(method, query).warnings.some(warning => warning.includes('shade')));
  assert.ok(!supportsCutoff(method, query).warnings.some(warning => warning.includes('quality is max(0, 1 - OKLab distance')));
});

test('shade feedback verifies its own measured geometry and never claims baseline parity', async () => {
  for (const bucketCount of [16, 64, 256, 1024]) {
    const calls = [];
    const candidate = await createCandidate({ config: { id: method, parameters: { bucketCount } }, context: { corpus: [{ id: 'one' }] } }, {
      verifyShadeIndex: async request => { calls.push(request); return { count: 1, completeIdsVerified: true, allValuesVerified: true, metricDefinitionVerified: true }; },
      verifyCutoffIndex: () => { throw Error('Wrong extraction verifier'); },
      api: async endpoint => ({ body: endpoint.startsWith('_nodes') ? { nodes: { one: { jvm: { mem: { heap_max_in_bytes: 2147483648 } } } } } : { version: { number: 'test' } } }),
      executeSearch: async request => { calls.push(request); return { hits: [{ id: 'one', score: .1 }], evidence: {} }; },
    });
    const prepared = await candidate.prepare();
    await candidate.search({ caseData: { query }, limit: 1 });
    assert.ok(calls.every(call => call.index === `color-exploration-shade-${bucketCount}-real-v1`));
    assert.equal(prepared.metricDefinitionVerified, true);
    assert.equal(prepared.hard50ParityVerified, undefined);
    assert.equal(candidate.metadata.metric, 'shade-aware');
    assert.equal(candidate.metadata.representation, `shade-coverage-quality-${bucketCount}`);
    assert.ok(candidate.metadata.sourceFiles.includes('exploration/shade-definition.mjs'));
  }
  const incomplete = await createCandidate({ config: { id: method }, context: { corpus: [{ id: 'one' }] } }, {
    verifyShadeIndex: async () => ({ count: 1, completeIdsVerified: true, allValuesVerified: true }),
  });
  await assert.rejects(incomplete.prepare(), /complete cutoff corpus/);
});

test('real shade search and inspection agree across banks and controls', { skip: process.env.COLOR_SHADE_INTEGRATION !== '1' }, async () => {
  for (const bucketCount of [16, 64, 256, 1024]) for (const qualityInfluence of [1, 3]) {
    const parameters = { bucketCount, qualityInfluence, qualityCurve: 'power', cutoffBlendExponent: 3 };
    const result = await executeSearch({ method, query, parameters, limit: 10 });
    assert.equal(result.hits.length, 10);
    assert.ok(result.hits[0].score > 0);
    const inspected = await inspectCutoff({ method, query, parameters, id: result.hits[0].id });
    assert.equal(inspected.definition.metric, 'shade-aware');
    assert.equal(inspected.score.actual, result.hits[0].score);
    assert.ok(Math.abs(inspected.score.difference) < 1e-6);
    assert.equal(inspected.regions.length, bucketCount);
  }
});
