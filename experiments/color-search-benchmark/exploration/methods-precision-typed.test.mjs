import test from 'node:test';
import assert from 'node:assert/strict';
import { PRECISION_TYPED_SCRIPT, buildPrecisionTypedQuery, supportsPrecisionTyped, searchPrecisionTypedBounded } from './methods-precision-typed.mjs';
import { buildDirectPaletteQuery } from './methods-direct-palette.mjs';
import { INDEX, searchIndex } from './service.mjs';

test('typed precision retains range-edge and support parameters without per-centroid maps', () => {
  const query = { mode: 'vibe', targets: [{ color: '#4c8c72', space: 'oklab', tolerance: { distance: 0.04 }, edgeWeight: 0.7 }] };
  const body = buildPrecisionTypedQuery({ query, parameters: { minimumSupport: 0.1 }, eligibleIds: ['a'] });
  assert.equal(body.query.script_score.script.params.radius, 0.04);
  assert.equal(body.query.script_score.script.params.edgeWeight, 0.7);
  assert.equal(body.query.script_score.script.params.minimumSupport, 0.1);
  const loop = PRECISION_TYPED_SCRIPT.slice(PRECISION_TYPED_SCRIPT.indexOf('for ('));
  assert.doesNotMatch(loop, /params\.|Map |List |hsv|hsl/);
  assert.deepEqual(body.query.script_score.query.bool.filter, [{ ids: { values: ['a'] } }]);
  assert.equal(supportsPrecisionTyped({ text: 'red' }).supported, false);
});

test('typed precision preserves all 545 service scores and ordered IDs', { skip: process.env.COLOR_EXPLORATION_PRECISION_TYPED_TEST !== '1' }, async () => {
  const queries = ['#ff2200', '#4c8c72', '#808080', '#080808'].map(swatchHex => ({ swatchHex }));
  queries.push({ mode: 'vibe', targets: [{ color: '#ff2200', space: 'oklab', tolerance: { distance: 0 }, edgeWeight: 0.5 }] });
  queries.push({ mode: 'vibe', targets: [{ color: '#4c8c72', space: 'oklab', tolerance: { distance: 0.2 }, edgeWeight: 1 }] });
  for (const query of queries) {
    const reference = await searchIndex(INDEX, buildDirectPaletteQuery({ method: 'palette-direct-precision', query, limit: 1000 }));
    const actual = await searchIndex(INDEX, buildPrecisionTypedQuery({ query, limit: 1000 }));
    assert.equal(actual.hits.length, 545);
    assert.deepEqual(actual.hits, reference.hits);
    const bounded = await searchPrecisionTypedBounded({ index: INDEX, query, limit: 20 });
    assert.deepEqual(bounded.hits, reference.hits.slice(0, 20));
    assert.equal(bounded.evidence.exactScorer, 'palette-precision-typed');
  }
});
