// Prepared during capacity timing. These tests have intentionally NOT run yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { favoriteCardinalityNecessaryThresholds, favoriteCardinalityRangeFilters } from './favorite-cardinality-bounds.mjs';
const clausesFor = n => Array.from({ length: n }, (_, i) => ({ field: 'u' + i, factor: 1 / n, modifier: 'none', missing: 0 }));
const maximaFor = values => Object.fromEntries(values.map((value, i) => ['u' + i, value]));
// Independent intended native arithmetic for unique equal-weight clauses.
const score = values => Math.fround(values.reduce((sum, value) => sum + Math.fround(Math.fround(value) * Math.fround(1 / values.length)), 0));
const survives = (values, conditions) => conditions.every(condition => values.filter(value => Math.fround(value) >= condition.threshold).length >= condition.minimumShouldMatch);
const compile = (maxima, lower, requiredCounts) => favoriteCardinalityNecessaryThresholds({ clauses: clausesFor(maxima.length), maxima: maximaFor(maxima), kthSeedScore: lower, requiredCounts });
const bits = new DataView(new ArrayBuffer(4));
const predecessor = value => { bits.setFloat32(0, value); const word = bits.getUint32(0); bits.setUint32(0, word - 1); return bits.getFloat32(0); };

test('five-color ladder rejects concentrated weak combinations and retains native winners/ties', () => {
  const lower = Math.fround(.7), result = compile([1, 1, 1, 1, 1], lower);
  assert.equal(result.fallback, null);
  assert.deepEqual(result.conditions.map(row => row.minimumShouldMatch), [2, 3, 4]);
  for (const [i, expected] of [.625, .5, .25].entries()) assert.ok(Math.abs(result.conditions[i].threshold - expected) < 1e-5);
  assert.equal(survives([1, 1, .4, .4, .4], result.conditions), false);
  for (const values of [[1, 1, .5, .5, .5], [.7, .7, .7, .7, .7], [1, 1, 1, .5, 0]]) {
    assert.ok(score(values) >= lower); assert.ok(survives(values, result.conditions));
  }
  for (const row of result.conditions) {
    assert.ok(row.certificate.excludedScoreUpperBound < lower);
    assert.ok(row.certificate.nextExcludedScoreUpperBound >= lower);
  }
});

test('a rejected boundary vector cannot equal the lower score, including unequal maxima', () => {
  for (const maxima of [[1, 1], [1, .8, .6], [.9, .8, .6, .5, .4]]) {
    const lower = score(maxima.map(value => value * .8)), result = compile(maxima, lower);
    for (const condition of result.conditions) {
      const caps = maxima.map(value => Math.min(Math.fround(value), predecessor(condition.threshold)));
      for (let mask = 0; mask < 2 ** maxima.length; mask++) {
        if (mask.toString(2).replaceAll('0', '').length !== condition.minimumShouldMatch - 1) continue;
        const values = caps.map((cap, i) => mask & (1 << i) ? Math.fround(maxima[i]) : cap);
        assert.equal(survives(values, [condition]), false); assert.ok(score(values) < lower);
      }
    }
    assert.ok(survives(maxima, result.conditions));
  }
});

test('seeded finite-field samples retain every native score at or above the lower bound', () => {
  let state = 72493; const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  for (let n = 2; n <= 10; n++) for (let fixture = 0; fixture < 12; fixture++) {
    const maxima = Array.from({ length: n }, () => Math.fround(random())), anchor = maxima.map(value => Math.fround(value * (.3 + .7 * random())));
    const lower = score(anchor), result = compile(maxima, lower);
    assert.ok(survives(anchor, result.conditions));
    for (let sample = 0; sample < 100; sample++) {
      const values = maxima.map(value => Math.fround(value * random()));
      if (score(values) >= lower) assert.ok(survives(values, result.conditions));
    }
  }
});

test('zero/subnormal inputs and impossible bounds fail safely', () => {
  assert.equal(compile([0, 0], 0).fallback, 'zero-lower-bound');
  assert.equal(compile([0, 0], .5).fallback, 'inconsistent-maxima');
  const tiny = [2 ** -140, 2 ** -142, -0], lower = score(tiny), result = compile(tiny, lower);
  assert.ok(survives(tiny, result.conditions));
  assert.deepEqual(compile([-0, .5], .1), compile([0, .5], .1));
  assert.throws(() => compile([NaN, 1], .1), /maximum/);
  assert.throws(() => compile([1.1, 1], .1), /maximum/);
  assert.throws(() => compile([1, 1], Infinity), /seed score/);
});

test('duplicates and changed native semantics preserve conservative fallback', () => {
  const clauses = clausesFor(2); clauses[1].field = clauses[0].field;
  assert.equal(favoriteCardinalityNecessaryThresholds({ clauses, maxima: { u0: 1 }, kthSeedScore: .7 }).fallback, 'duplicate-utility-fields');
  for (const patch of [{ factor: .4 }, { modifier: 'sqrt' }, { missing: .1 }]) {
    const changed = clausesFor(2); Object.assign(changed[0], patch);
    assert.equal(favoriteCardinalityNecessaryThresholds({ clauses: changed, maxima: { u0: 1, u1: 1 }, kthSeedScore: .7 }).fallback, 'unsupported-clause-semantics');
  }
});

test('caller can select conditions without mutating score, transport or input data', () => {
  const options = { clauses: clausesFor(5), maxima: maximaFor([1, 1, 1, 1, 1]), kthSeedScore: .7, requiredCounts: [4, 2] }, before = structuredClone(options);
  const result = favoriteCardinalityNecessaryThresholds(options);
  assert.deepEqual(options, before); assert.deepEqual(result.conditions.map(row => row.minimumShouldMatch), [2, 4]);
  const filters = favoriteCardinalityRangeFilters(result);
  assert.equal(filters.length, 2); assert.equal(filters[0].bool.minimum_should_match, 2);
  assert.equal(filters[0].bool.should.length, 5);
  assert.deepEqual(favoriteCardinalityRangeFilters({ conditions: [], fallback: 'zero-lower-bound' }), []);
  for (const requiredCounts of [[2, 2], [0], [6], [.5]]) assert.throws(() => favoriteCardinalityNecessaryThresholds({ ...options, requiredCounts }), /Required counts/);
  assert.deepEqual(compile([1], .5).conditions, []);
});

const successor = value => {
  if (value === 0) return 2 ** -149;
  bits.setFloat32(0, value); const word = bits.getUint32(0); bits.setUint32(0, word + 1); return bits.getFloat32(0);
};
function assertWinnerSurvives(values, lower, conditions) {
  if (score(values) >= lower) assert.ok(survives(values, conditions), JSON.stringify({ values, lower, score: score(values), conditions }));
}

test('explicit k=1 and k=n preserve representable threshold neighbors from subnormal values through one', () => {
  const scales = [0, 2 ** -149, 2 ** -140, 2 ** -126, 2 ** -24, .125, .5, predecessor(1), 1];
  for (let n = 1; n <= 10; n++) for (const scale of scales) {
    const maxima = Array.from({ length: n }, (_, i) => Math.fround(scale * (i % 2 ? .875 : 1)));
    const anchors = [maxima, maxima.map(value => Math.fround(value * .75))];
    for (const anchor of anchors) {
      const lower = score(anchor), result = compile(maxima, lower, n === 1 ? [1] : [1, n]);
      assertWinnerSurvives(anchor, lower, result.conditions);
      if (lower === 0) { assert.equal(result.fallback, 'zero-lower-bound'); continue; }
      assert.equal(result.fallback, null);
      for (const condition of result.conditions) {
        assert.ok(condition.minimumShouldMatch === 1 || condition.minimumShouldMatch === n);
        const neighbors = [predecessor(condition.threshold), condition.threshold, successor(condition.threshold)];
        for (const value of neighbors) assertWinnerSurvives(maxima.map(maximum => Math.min(maximum, value)), lower, result.conditions);
        for (let rotate = 0; rotate < n; rotate++) {
          const values = maxima.map((maximum, i) => Math.min(maximum, neighbors[(i + rotate) % neighbors.length]));
          assertWinnerSurvives(values, lower, result.conditions);
        }
        // k=1 has no exceptional fields. k=n allows every field but one to
        // reach its maximum. These are all exceptional-set boundary vectors.
        for (let excludedField = 0; excludedField < (condition.minimumShouldMatch === 1 ? 1 : n); excludedField++) {
          const values = maxima.map((maximum, i) => condition.minimumShouldMatch === 1 || i === excludedField
            ? Math.min(maximum, neighbors[0]) : maximum);
          assert.equal(survives(values, [condition]), false);
          assert.ok(score(values) < lower);
        }
        assert.ok(condition.certificate.excludedScoreUpperBound < lower);
        assert.ok(condition.certificate.nextExcludedScoreUpperBound >= lower);
      }
    }
  }
});

test('native product-rounding boundaries retain ties for every supported target count', () => {
  for (let n = 2; n <= 10; n++) for (const scale of [.125, .5, predecessor(1)]) {
    const factor = Math.fround(1 / n), product = Math.fround(scale * factor);
    // Construct a utility near the exact midpoint between neighboring product
    // floats, then probe the adjacent utility floats independently of the bound.
    const productMidpoint = (product + successor(product)) / 2;
    const center = Math.min(1, Math.fround(productMidpoint / factor));
    const neighbors = [predecessor(center), center, Math.min(1, successor(center))];
    const products = neighbors.map(value => Math.fround(value * factor));
    assert.ok(products[0] <= products[1] && products[1] <= products[2]);
    assert.ok(products[0] < products[2]);
    const maxima = Array.from({ length: n }, () => 1);
    for (let rotation = 0; rotation < neighbors.length; rotation++) {
      const anchor = maxima.map((_, i) => neighbors[(i + rotation) % neighbors.length]), lower = score(anchor);
      const requiredCounts = [...new Set([1, Math.ceil(n / 2), n])];
      const result = compile(maxima, lower, requiredCounts);
      assertWinnerSurvives(anchor, lower, result.conditions);
      for (const value of neighbors) assertWinnerSurvives(maxima.map(() => value), lower, result.conditions);
      for (let i = 0; i < n; i++) for (const value of neighbors) {
        const changed = [...anchor]; changed[i] = value;
        assertWinnerSurvives(changed, lower, result.conditions);
      }
    }
  }
});

test('missing or malformed clauses and maxima never produce filters', () => {
  const options = { clauses: clausesFor(2), maxima: maximaFor([1, 1]), kthSeedScore: .7 };
  for (const clauses of [undefined, null, [], clausesFor(11), [null], [{ field: '', factor: 1 }], [{ field: 'u0', factor: 0 }], [{ field: 'u0', factor: NaN }]]) {
    assert.throws(() => favoriteCardinalityNecessaryThresholds({ ...options, clauses }));
  }
  for (const maxima of [undefined, null, {}, { u0: 1 }, { u0: 1, u1: -1 }, { u0: 1, u1: Infinity }]) {
    assert.throws(() => favoriteCardinalityNecessaryThresholds({ ...options, maxima }), /maximum/);
  }
  assert.throws(() => favoriteCardinalityNecessaryThresholds({ ...options, kthSeedScore: -1 }), /seed score/);
  assert.throws(() => favoriteCardinalityNecessaryThresholds({ ...options, kthSeedScore: NaN }), /seed score/);
});
