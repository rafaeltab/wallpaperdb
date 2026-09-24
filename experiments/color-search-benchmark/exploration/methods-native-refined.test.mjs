import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_REFINED_METHODS, supportsNativeRefined, buildNativeRefinedQuery } from './methods-native-refined.mjs';

const portion = (percent = 40) => ({ mode: 'proportions', targets: [{ name: 'green', percent }] });

test('native refinements retain named vibe and partial amount semantics without any scripts', () => {
  for (const method of NATIVE_REFINED_METHODS) for (const query of [{ text: 'red' }, portion(), { mode: 'proportions', targets: [{ name: 'red', percent: 50 }, { name: 'green', percent: 50 }] }]) {
    assert.equal(supportsNativeRefined(method, query).supported, true);
    const body = buildNativeRefinedQuery({ method, query, limit: 7 });
    assert.equal(body.size, 7);
    assert.equal(body._source, false);
    assert.ok(!JSON.stringify(body).includes('script'));
    assert.deepEqual(body.sort, [{ _score: 'desc' }, { id: 'asc' }]);
  }
});

test('custom distances and relative/accent intents remain explicitly unsupported', () => {
  for (const query of [
    { swatchHex: '#ff2200' },
    { mode: 'vibe', targets: [{ name: 'red', color: '#ff0000', tolerance: { distance: 0.2 } }] },
    { text: 'dark with bright spots' },
    { mode: 'vibe', targets: [{ name: 'dark' }, { name: 'bright' }] },
    { text: 'grayscale with red' },
  ]) {
    const supported = supportsNativeRefined('native-quality-linear', query);
    assert.equal(supported.supported, false);
    assert.ok(supported.reason);
    assert.throws(() => buildNativeRefinedQuery({ method: 'native-quality-linear', query }));
  }
});

test('closed palettes disclose omitted purity while partial queries leave remainder unrestricted', () => {
  const closed = supportsNativeRefined('native-quality-asymmetric', { mode: 'proportions', targets: [{ name: 'red', percent: 50 }, { name: 'green', percent: 50 }] });
  assert.ok(closed.warnings.some(warning => /purity/i.test(warning)));
  const partial = buildNativeRefinedQuery({ method: 'native-quality-asymmetric', query: portion() });
  assert.ok(!JSON.stringify(partial).includes('union'));
  assert.ok(!JSON.stringify(partial).includes('remainder'));
});

test('all hard eligibility conditions remain within OpenSearch', () => {
  const body = buildNativeRefinedQuery({ method: 'native-quality-linear', query: portion(), eligibleIds: ['a', 'b'], excludedIds: ['b'], filter: { term: { cohort: 'real' } } });
  const serialized = JSON.stringify(body.query.bool.filter);
  assert.match(serialized, /"values":\["a","b"\]/);
  assert.match(serialized, /"must_not":\[\{"ids":\{"values":\["b"\]/);
  assert.match(serialized, /"cohort":"real"/);
});

test('asymmetric native decay distinguishes overshoot from shortfall using filtered functions', () => {
  const symmetric = buildNativeRefinedQuery({ method: 'native-quality-linear', query: portion() });
  const asymmetric = buildNativeRefinedQuery({ method: 'native-quality-asymmetric', query: portion() });
  const symFunctions = symmetric.query.bool.should[0].function_score.functions;
  const asymFunctions = asymmetric.query.bool.should[0].function_score.functions;
  assert.equal(symFunctions[0].linear.cov_green.scale, 5000);
  assert.equal(asymFunctions[0].linear.cov_green.scale, 5000);
  assert.equal(asymFunctions[1].linear.cov_green.scale, 5000 / 1.5);
  assert.deepEqual(asymFunctions[0].filter, { range: { cov_green: { lte: 4000 } } });
  assert.deepEqual(asymFunctions[1].filter, { range: { cov_green: { gt: 4000 } } });
});

test('zero desired area does not reward color quality and invalid parameters fail', () => {
  const body = buildNativeRefinedQuery({ method: 'native-quality-asymmetric', query: { mode: 'proportions', targets: [{ name: 'red', percent: 0 }, { name: 'green', percent: 40 }] } });
  assert.ok(!JSON.stringify(body.query.bool.should[0]).includes('quality_red'));
  for (const parameters of [{ qualityPenalty: -0.1 }, { qualityPenalty: 1.1 }, { areaPower: 0.65 }, { excessPenalty: 0 }, { unexpected: 1 }]) {
    assert.throws(() => buildNativeRefinedQuery({ method: 'native-quality-linear', query: portion(), parameters }));
  }
});
