import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSearchResponse, safeIndexName, toIndexDocument } from './service.mjs';

test('partial service results cannot masquerade as a complete ranking', () => {
  assert.throws(() => validateSearchResponse({ timed_out: true, hits: { hits: [] } }), /timed out/);
  assert.throws(() => validateSearchResponse({ _shards: { failed: 1 }, hits: { hits: [] } }), /shard/);
  assert.throws(() => validateSearchResponse({ hits: { hits: [{ _id: 'a', _score: NaN }] } }), /score/);
  assert.deepEqual(validateSearchResponse({ hits: { hits: [{ _id: 'a', _score: 2 }] } }), [{ id: 'a', score: 2 }]);
});

test('scratch index lifecycle cannot mutate historical or application indexes', () => {
  assert.equal(safeIndexName('color-exploration-real-v1'), 'color-exploration-real-v1');
  for (const name of ['wallpapers', 'color-global-real-v1', '*', 'color-exploration-a,b', '../color-exploration-a'])
    assert.throws(() => safeIndexName(name));
});

test('index vectors retain area distributions and construct Hellinger coordinates', () => {
  const doc = toIndexDocument({ id: 'a', hsv64: [0.25, 0.75], rgb512: [0.36, 0.64], pixel_total: 100, rgb4096: [12], cov_red: 4000, quality_red: 0.7 });
  assert.deepEqual(doc.hsv_l2, [0.25, 0.75]);
  assert.deepEqual(doc.hsv_sqrt, [0.5, Math.sqrt(0.75)]);
  assert.deepEqual(doc.rgb_sqrt, [0.6, 0.8]);
  assert.equal(doc.cov_red, 4000);
  assert.equal(doc.quality_red, 0.7);
  assert.equal(doc.hsv64, undefined);
});
