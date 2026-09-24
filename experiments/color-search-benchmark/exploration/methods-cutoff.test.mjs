import test from 'node:test';
import assert from 'node:assert/strict';
import { CUTOFF_METHODS, cutoffParameters, resolveCutoffTargets, supportsCutoff, buildCutoffQuery } from './methods-cutoff.mjs';
import { cutoffFields, cutoffIndexForCount, CUTOFF_LEVELS } from './cutoff-definition.mjs';
import { cutoffQueryComponents } from './cutoff-blend.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';
import { indexForMethod } from './registry.mjs';
import { createCandidate } from './adapter.mjs';

const query = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 40 }, { name: 'dark', percent: 60 }] };
test('all cutoff profiles resolve only indexed fields, with named features counted once', () => {
  for (const method of CUTOFF_METHODS) for (const bucketCount of [16, 64, 256, 1024]) for (const { cutoff: pixelCutoff } of CUTOFF_LEVELS) {
    const parameters = { bucketCount, pixelCutoff }, resolved = resolveCutoffTargets(method, query, { parameters });
    assert.ok(overlapRegionsForCount(bucketCount).some(region => region.index === resolved.targets[0].regionIndex));
    const expected = cutoffQueryComponents(method.profile, pixelCutoff);
    assert.equal(resolved.targets[0].components.length, expected.length);
    resolved.targets[0].components.forEach((component, i) => {
      assert.equal(component.coverageField, cutoffFields(resolved.targets[0].regionIndex, expected[i].kernel, expected[i].cutoff).coverage);
      assert.equal(component.componentWeight, expected[i].weight);
    });
    assert.equal(resolved.targets[1].components.length, 1);
    assert.equal(resolved.targets[1].components[0].coverageField, 'cov_dark');
    assert.equal(resolved.targets[1].components[0].componentWeight, 1);
    const body = buildCutoffQuery({ method, query, parameters });
    assert.equal(body.query.bool.should.length, expected.length + 1);
    assert.ok(!JSON.stringify(body).includes('script'));
    assert.ok(Math.abs(body.query.bool.should.reduce((sum, clause) => sum + clause.function_score.functions.at(-1).weight, 0) - 1) < 1e-12);
    assert.equal(indexForMethod(method, undefined, parameters), method.metric === 'shade-hue-aware' ? `color-exploration-shade-hue-${bucketCount}-real-v1` : method.metric === 'shade-aware' ? `color-exploration-shade-${bucketCount}-real-v1` : cutoffIndexForCount(bucketCount));
    assert.equal(indexForMethod(method, 'scratch-cutoff-index', parameters), 'scratch-cutoff-index');
  }
});

test('cutoff controls validate and explicit radius must match the chosen support', () => {
  assert.equal(cutoffParameters('cutoff-hard').pixelCutoff, .5);
  assert.equal(cutoffParameters('cutoff-hard').namedMode, 'concrete-swatches');
  for (const parameters of [{ pixelCutoff: .6 }, { pixelCutoff: '0.5' }, { bucketCount: 32 }, { namedMode: 'other' }, { qualityInfluence: 4 }, { minimumQuality: 2 }, { bogus: 1 }]) assert.throws(() => cutoffParameters('cutoff-hard', parameters));
  for (const { cutoff: pixelCutoff, radius } of CUTOFF_LEVELS) {
    const parameters = { pixelCutoff };
    assert.equal(supportsCutoff('cutoff-hard', { targets: [{ color: '#ff2200' }] }, { parameters }).supported, true);
    assert.equal(supportsCutoff('cutoff-hard', { targets: [{ color: '#ff2200', distance: radius }] }, { parameters }).supported, true);
    assert.equal(supportsCutoff('cutoff-hard', { targets: [{ color: '#ff2200', distance: radius + .001 }] }, { parameters }).supported, false);
    assert.equal(supportsCutoff('cutoff-hard', { targets: [{ color: '#ff2200', ranges: [] }] }, { parameters }).supported, false);
    assert.equal(supportsCutoff('cutoff-hard', { targets: [{ color: '#ff2200', edgeWeight: .7 }] }, { parameters }).supported, false);
  }
});

test('all-levels canonicalizes the unused starting cutoff and scopes distribution controls to this method', () => {
  const parameters = cutoffParameters('cutoff-all-levels');
  assert.equal(parameters.pixelCutoff, 0);
  assert.equal(parameters.cutoffBlendExponent, 0);
  for (const { cutoff: pixelCutoff } of CUTOFF_LEVELS) assert.equal(cutoffParameters('cutoff-all-levels', { pixelCutoff }).pixelCutoff, 0);
  for (const cutoffBlendExponent of [-1, 6.1, '3', null, NaN]) assert.throws(() => cutoffParameters('cutoff-all-levels', { cutoffBlendExponent }), /cutoffBlendExponent/);
  assert.throws(() => cutoffParameters('cutoff-all-levels', { pixelCutoff: .2 }), /pixelCutoff/);
  for (const method of CUTOFF_METHODS.filter(method => method.profile !== 'all-levels')) assert.throws(() => cutoffParameters(method, { cutoffBlendExponent: 0 }), /cutoffBlendExponent/);
  for (const radius of [.024, .06, .12, .18, .24]) {
    const result = supportsCutoff('cutoff-all-levels', { targets: [{ color: '#ff2200', distance: radius }] });
    assert.equal(result.supported, false);
    assert.match(result.reason, /explicit ranges/i);
  }
});

test('all-levels changes only component coefficients across distributions, with named targets still scored once', () => {
  const method = 'cutoff-all-levels', parameters = { cutoffBlendExponent: 6, qualityCurve: 'power', qualityInfluence: 3, minimumQuality: .7 };
  const targets = resolveCutoffTargets(method, query, { parameters }).targets;
  const actual = buildCutoffQuery({ method, query, parameters });
  const equal = buildCutoffQuery({ method, query, parameters: { ...parameters, cutoffBlendExponent: 0 } });
  assert.equal(targets[0].components.length, 5);
  assert.equal(targets[1].components.length, 1);
  assert.equal(actual.query.bool.should.length, 6);
  assert.deepEqual(actual.query.bool.filter, equal.query.bool.filter);
  assert.deepEqual(targets[0].components.map(component => component.pixelCutoff), [0, .25, .5, .75, .9]);
  actual.query.bool.should.forEach((clause, i) => {
    assert.deepEqual(clause.function_score.functions.slice(0, -1), equal.query.bool.should[i].function_score.functions.slice(0, -1));
    assert.equal(clause.function_score.functions.at(-1).weight, i < 5 ? targets[0].components[i].componentWeight / 2 : .5);
  });
});

test('named-family queries remain identical across all cutoff profiles, levels and banks', () => {
  const named = { mode: 'proportions', targets: [{ name: 'red', percent: 20 }, { name: 'grayscale', percent: 80 }] };
  const reference = buildCutoffQuery({ method: 'cutoff-hard', query: named, parameters: { namedMode: 'named-families' } });
  for (const method of CUTOFF_METHODS) for (const bucketCount of [16, 64, 256, 1024]) for (const { cutoff: pixelCutoff } of CUTOFF_LEVELS) {
    assert.deepEqual(buildCutoffQuery({ method, query: named, parameters: { namedMode: 'named-families', bucketCount, pixelCutoff } }), reference);
  }
});

test('consensus gates each component separately and zero amount targets remain quality-exempt', () => {
  const input = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 0 }, { color: '#00ff00', percent: 40 }] };
  const parameters = { minimumQuality: .7, qualityInfluence: 0, pixelCutoff: .5 };
  const targets = resolveCutoffTargets('cutoff-consensus', input, { parameters }).targets;
  const body = buildCutoffQuery({ method: 'cutoff-consensus', query: input, parameters });
  for (let i = 0; i < targets[0].components.length; i++) assert.ok(!JSON.stringify(body.query.bool.should[i]).includes('quality_'));
  for (let i = 0; i < targets[1].components.length; i++) {
    const clause = body.query.bool.should[i + targets[0].components.length];
    assert.deepEqual(clause.function_score.functions.find(fn => fn.weight === 0), { filter: { range: { [targets[1].components[i].qualityField]: { lt: Math.fround(.7) } } }, weight: 0 });
  }
  assert.equal(body.query.bool.filter.some(filter => filter.range), false);
});

test('all cutoff profiles support power quality without changing pixel fields or component weights', () => {
  for (const method of CUTOFF_METHODS) for (const bucketCount of [16, 64, 256, 1024]) for (const { cutoff: pixelCutoff } of CUTOFF_LEVELS) {
    const parameters = { bucketCount, pixelCutoff, minimumQuality: .7, qualityInfluence: 3 };
    assert.equal(cutoffParameters(method).qualityCurve, 'linear');
    const linear = buildCutoffQuery({ method, query, parameters });
    const power = buildCutoffQuery({ method, query, parameters: { ...parameters, qualityCurve: 'power' } });
    assert.deepEqual(power.query.bool.filter, linear.query.bool.filter);
    assert.equal(power.query.bool.should.length, linear.query.bool.should.length);
    power.query.bool.should.forEach((clause, i) => {
      const functions = clause.function_score.functions;
      const original = linear.query.bool.should[i].function_score.functions;
      assert.deepEqual(functions.filter(fn => !fn.script_score), original.filter(fn => !fn.linear || !Object.keys(fn.linear).some(field => field.startsWith('quality_'))));
      assert.equal(functions.filter(fn => fn.script_score).length, 1);
      assert.equal(functions.find(fn => fn.script_score).script_score.script.params.exponent, 3);
    });
    for (const qualityInfluence of [0, 1]) assert.deepEqual(
      buildCutoffQuery({ method, query, parameters: { ...parameters, qualityInfluence, qualityCurve: 'power' } }),
      buildCutoffQuery({ method, query, parameters: { ...parameters, qualityInfluence, qualityCurve: 'linear' } }),
    );
  }
  for (const qualityCurve of ['smooth', null, 1]) assert.throws(() => cutoffParameters('cutoff-hard', { qualityCurve }), /qualityCurve/);
});

test('feedback adapter records cutoff settings, verifies the complete measured corpus and uses its physical index', async () => {
  for (const bucketCount of [16, 64, 256, 1024]) {
    const parameters = { bucketCount, pixelCutoff: .25, namedMode: 'named-families', qualityInfluence: 2, minimumQuality: .7 };
    const calls = [], context = { corpus: [{ id: 'wallpaper-001' }] };
    const candidate = await createCandidate({ config: { id: `cutoff-test-${bucketCount}`, method: 'cutoff-consensus', parameters }, context }, {
      verifyCutoffIndex: async request => { calls.push(request); return { count: 1, completeIdsVerified: true, allValuesVerified: true, hard50ParityVerified: true }; },
      api: async endpoint => ({ body: endpoint.startsWith('_nodes') ? { nodes: { one: { jvm: { mem: { heap_max_in_bytes: 4294967296 } } } } } : { version: { number: 'test' } } }),
      executeSearch: async request => { calls.push(request); return { hits: [{ id: 'wallpaper-001', score: .5 }], evidence: {} }; },
    });
    const prepared = await candidate.prepare();
    assert.deepEqual(prepared.execution.topology, { nodes: 1, primaryShards: 1, jvmHeapMaxBytes: [4294967296] });
    const searched = await candidate.search({ caseData: { query }, limit: 3 });
    assert.ok(calls.every(call => call.index === cutoffIndexForCount(bucketCount)));
    assert.deepEqual(calls[0].expectedIds, ['wallpaper-001']);
    assert.equal(calls[0].bucketCount, bucketCount);
    assert.deepEqual(calls[1].parameters, parameters);
    assert.deepEqual(searched.hits, [{ id: 'wallpaper-001', score: .5 }]);
    assert.equal(candidate.metadata.bucketCount, bucketCount);
    assert.equal(candidate.metadata.pixelCutoff, .25);
    assert.equal(candidate.metadata.namedMode, 'named-families');
    assert.equal(candidate.metadata.profile, 'consensus');
    assert.equal(candidate.metadata.representation, `cutoff-coverage-quality-${bucketCount}`);
    assert.ok(candidate.metadata.sourceFiles.includes('exploration/cutoff-index.mjs'));
  }
  for (const missing of ['count', 'completeIdsVerified', 'allValuesVerified', 'hard50ParityVerified']) {
    const verification = { count: 1, completeIdsVerified: true, allValuesVerified: true, hard50ParityVerified: true };
    delete verification[missing];
    const candidate = await createCandidate({ config: { id: 'cutoff-hard' }, context: { corpus: [{ id: 'wallpaper-001' }] } }, {
      verifyCutoffIndex: async () => verification,
    });
    await assert.rejects(candidate.prepare(), /complete cutoff corpus/);
  }
});
