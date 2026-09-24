import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAP_METHODS, supportsOverlap, resolveOverlapTargets, buildOverlapQuery, overlapParameters } from './methods-overlap.mjs';
import { OVERLAP_REGIONS, regionFields } from './overlap-regions.mjs';

const dense = 'overlap-quality-dense';
const hybrid = 'overlap-quality-hybrid';
const partial = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 40 }] };

test('dense versus hybrid isolates the interpretation of concrete named colors', () => {
  const query = { mode: 'proportions', targets: [{ name: 'red', percent: 20 }, { name: 'grayscale', percent: 80 }] };
  const a = resolveOverlapTargets(dense, query), b = resolveOverlapTargets(hybrid, query);
  assert.equal(a.targets[0].kind, 'region');
  assert.equal(a.targets[1].kind, 'named');
  assert.equal(b.targets[0].kind, 'named');
  assert.equal(b.targets[1].kind, 'named');
  assert.equal(a.targets[0].anchorDistance, 0);
  assert.equal(a.targets[1].coverageField, 'cov_grayscale');
  assert.ok(a.warnings.some(value => /literal/i.test(value)));
});

test('picked colors use one nearest region and preserve amount separately from quality', () => {
  for (const method of OVERLAP_METHODS) {
    const resolved = resolveOverlapTargets(method, partial);
    const target = resolved.targets[0], anchor = OVERLAP_REGIONS[target.regionIndex];
    assert.equal(target.kind, 'region');
    assert.equal(target.amount, .4);
    assert.equal(target.regionHex, anchor.hex);
    assert.equal(target.coverageField, regionFields(anchor.index).coverage);
    assert.equal(target.qualityField, regionFields(anchor.index).quality);
    assert.ok(target.anchorDistance >= 0 && target.anchorDistance < .08);
    assert.equal(resolved.targets.length, 1, 'Overlapping neighbor areas are never summed.');
  }
});

test('fixed bank accepts its exact range and rejects controls it did not index', () => {
  for (const method of OVERLAP_METHODS) {
    for (const query of [partial, { swatchHex: '#ff2200' }, { targets: [{ color: '#ff2200', ranges: [{ space: 'oklab', distance: .12 }], edgeWeight: .5 }] }]) {
      assert.equal(supportsOverlap(method, query).supported, true);
    }
    for (const target of [
      { color: '#ff2200', distance: .2 },
      { color: '#ff2200', edgeWeight: .7 },
      { color: '#ff2200', ranges: [] },
      { color: '#ff2200', ranges: [{ space: 'rgb', r: .2, g: .2, b: .2 }] },
      { name: 'red', edgeWeight: .7 },
    ]) assert.equal(supportsOverlap(method, { targets: [target] }).supported, false, JSON.stringify(target));
    assert.equal(supportsOverlap(method, { text: 'grayscale with red' }).supported, false);
    assert.equal(supportsOverlap(method, { text: 'dark with bright spots' }).supported, false);
  }
});

test('explicit radius on named queries uses a region in both variants', () => {
  const query = { targets: [{ name: 'red', tolerance: { distance: .12 } }] };
  assert.equal(resolveOverlapTargets(hybrid, query).targets[0].kind, 'region');
});

test('native query scores eligible documents globally and has no ranking script', () => {
  const body = buildOverlapQuery({ method: dense, query: partial, limit: 7, eligibleIds: ['a', 'b'], excludedIds: ['b'], filter: { term: { cohort: 'real' } } });
  assert.equal(body.size, 7);
  assert.equal(body._source, false);
  assert.deepEqual(body.sort, [{ _score: 'desc' }, { id: 'asc' }]);
  assert.ok(!JSON.stringify(body).includes('script'));
  assert.match(JSON.stringify(body.query.bool.filter), /"values":\["a","b"\]/);
  assert.match(JSON.stringify(body.query.bool.filter), /"must_not":\[\{"ids":\{"values":\["b"\]/);
  assert.match(JSON.stringify(body.query.bool.filter), /"cohort":"real"/);
  const target = resolveOverlapTargets(dense, partial).targets[0];
  const functions = body.query.bool.should[0].function_score.functions;
  assert.equal(functions[0].linear[target.coverageField].scale, 5000);
  assert.equal(functions[1].linear[target.coverageField].scale, 5000 / 1.5);
  assert.deepEqual(functions[0].filter, { range: { [target.coverageField]: { lte: 4000 } } });
  assert.deepEqual(functions[1].filter, { range: { [target.coverageField]: { gt: 4000 } } });
});

test('multiple targets remain marginal areas and closed palettes disclose omitted purity', () => {
  const query = { mode: 'proportions', overlap: 'marginal', targets: [{ color: '#ff2200', percent: 70 }, { color: '#f02000', percent: 70 }] };
  const resolved = resolveOverlapTargets(dense, query);
  assert.equal(resolved.targets.length, 2);
  assert.ok(resolved.warnings.some(value => /overlap/i.test(value)));
  assert.ok(resolved.warnings.some(value => /purity/i.test(value)));
  const body = buildOverlapQuery({ method: dense, query });
  assert.equal(body.query.bool.should.length, 2);
  for (const clause of body.query.bool.should) assert.deepEqual(clause.function_score.functions.at(-1), { weight: .5 });
});

test('zero desired area ignores quality and unsupported parameters fail early', () => {
  const query = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 0 }, { name: 'green', percent: 40 }] };
  const target = resolveOverlapTargets(dense, query).targets[0];
  const body = buildOverlapQuery({ method: dense, query });
  assert.ok(!JSON.stringify(body.query.bool.should[0]).includes(target.qualityField));
  for (const parameters of [{ areaPower: .65 }, { qualityPenalty: 1.2 }, { excessPenalty: 0 }, { other: 1 }]) assert.throws(() => overlapParameters(dense, parameters));
});
