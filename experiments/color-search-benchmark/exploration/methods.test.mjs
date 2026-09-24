import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODS, buildQuery, supports, interpretQuery } from './methods.mjs';
import { membership } from './query.mjs';
import { INDEX, searchIndex } from './service.mjs';

test('whole-image target amounts retain the unspecified remainder', () => {
  const query = interpretQuery({ colorTargets: [{ colorName: 'green', targetImagePercent: 40 }], unspecifiedRemainderPercent: 60 });
  assert.equal(query.supported, true);
  assert.equal(query.targets[0].amount, 0.4);
  assert.equal(query.remainder, 0.6);
  const body = buildQuery({ method: 'histogram-composition-exact', query: { colorTargets: [{ colorName: 'green', targetImagePercent: 40 }] } });
  assert.equal(body.query.script_score.script.params.targets[0], 0.4);
  assert.equal(body.query.script_score.script.params.remainder, 0.6);
});

test('range boundary retains full area and half quality', () => {
  const compiled = interpretQuery({ mode: 'proportions', targets: [{ color: '#000000', percent: 70, space: 'rgb', tolerance: { r: 0.2, g: 0.2, b: 0.2 }, edgeWeight: 0.5 }] });
  assert.equal(compiled.supported, true);
  assert.deepEqual(membership([0.2, 0, 0], compiled.targets[0]), { area: 1, quality: 0.5 });
  assert.deepEqual(membership([0.201, 0, 0], compiled.targets[0]), { area: 0, quality: 0 });
});

test('eligibility is sent to OpenSearch instead of applied to local hits', () => {
  const body = buildQuery({ method: 'hsv-cosine-ann', query: { text: 'red', subjectRequest: 'city' }, eligibleIds: ['city-a', 'city-b'], excludedIds: ['city-b'] });
  assert.deepEqual(body.query.knn.hsv_cosine.filter.bool.filter, [{ ids: { values: ['city-a', 'city-b'] } }]);
  assert.deepEqual(body.query.knn.hsv_cosine.filter.bool.must_not, [{ ids: { values: ['city-b'] } }]);
});

test('named scalar methods explicitly reject arbitrary ranges', () => {
  const support = supports('native-area-linear', { mode: 'vibe', targets: [{ color: '#ff2200', space: 'rgb', tolerance: { r: 0.2, g: 0.2, b: 0.2 } }] });
  assert.equal(support.supported, false);
  assert.match(support.reason, /arbitrary/);
});

test('vector controls do not silently ignore custom range distances', () => {
  assert.equal(supports('hsv-cosine-ann', { swatchHex: '#ff2200' }).supported, true);
  const custom = { mode: 'vibe', targets: [{ color: '#ff2200', space: 'oklab', tolerance: { distance: 0.01 } }] };
  assert.equal(supports('hsv-cosine-ann', custom).supported, false);
  assert.equal(supports('histogram-composition-exact', custom).supported, true);
});

test('all sixteen registered methods build a service query', () => {
  assert.ok(METHODS.length >= 16);
  for (const method of METHODS) {
    const body = buildQuery({ method, query: { text: 'red' }, limit: 7 });
    assert.equal(body.size, 7);
    assert.equal(body._source, false);
    assert.ok(body.query);
  }
});

test('unknown query properties and impossible remainder are rejected', () => {
  assert.equal(interpretQuery({ text: 'red', expectedOrder: ['a'] }).supported, false);
  assert.equal(interpretQuery({ colorTargets: [{ colorName: 'green', targetImagePercent: 40 }], unspecifiedRemainderPercent: 40 }).supported, false);
});

test('all methods execute real OpenSearch queries with no local reranking', { skip: process.env.COLOR_EXPLORATION_METHOD_INTEGRATION !== '1' }, async () => {
  for (const method of METHODS) {
    for (const query of [{ text: 'red' }, { colorTargets: [{ colorName: 'green', targetImagePercent: 40 }], unspecifiedRemainderPercent: 60 }]) {
      const result = await searchIndex(INDEX, buildQuery({ method, query, limit: 5 }));
      assert.equal(result.hits.length, 5, method.id);
      for (let i = 1; i < result.hits.length; i++) assert.ok(result.hits[i].score <= result.hits[i - 1].score, method.id);
    }
  }
  for (const id of ['palette-area-exact', 'histogram-composition-exact', 'feature-composition-exact', 'native-area-linear']) {
    const result = await searchIndex(INDEX, buildQuery({ method: id, query: { text: 'mostly grayscale, with red accents' }, limit: 5 }));
    assert.equal(result.hits.length, 5, id);
  }
});
