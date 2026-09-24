import test from 'node:test';
import assert from 'node:assert/strict';
import { compareFavoriteRankings } from './favorite-optimization-fidelity.mjs';
test('fidelity separates numeric ties from meaningful ordering changes', () => {
  const original = [{ id: 'a', score: .9 }, { id: 'b', score: .9 }, { id: 'c', score: .3 }];
  const ties = compareFavoriteRankings(original, [original[1], original[0], original[2]]);
  assert.equal(ties.inversions, 1); assert.equal(ties.meaningfulInversions, 0); assert.equal(ties.maximumScoreError, 0);
  const changed = compareFavoriteRankings(original, [...original].reverse());
  assert.equal(changed.meaningfulInversions, 2); assert.ok(changed.largestInversionScoreGap > .59);
  assert.throws(() => compareFavoriteRankings(original, [original[0], original[0], original[1]]));
});
