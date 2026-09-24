import test from 'node:test';
import assert from 'node:assert/strict';
import { CUTOFF_LEVELS, cutoffComponents, cutoffWeight, cutoffMembership, cutoffFields, cutoffIndexForCount } from './cutoff-definition.mjs';
import { OVERLAP_REGIONS, overlapMembership } from './overlap-regions.mjs';

test('fixed quality reference preserves old hard 50% membership including its boundary', () => {
  for (const region of OVERLAP_REGIONS.slice(0, 8)) for (const distance of [0, .03, .119, .12, .121, .24, .241]) {
    const lab = [region.lab[0] + distance, region.lab[1], region.lab[2]];
    const old = overlapMembership(lab, region), current = cutoffMembership(lab, region);
    assert.equal(current.area, old.area);
    assert.ok(Math.abs(current.quality - old.quality) < 1e-15);
  }
});

test('q00 has bounded physical support and smooth kernels vanish at the edge', () => {
  for (const level of CUTOFF_LEVELS) {
    assert.equal(cutoffWeight(0, 'hard', level.cutoff), 1);
    assert.equal(cutoffWeight(level.radius, 'hard', level.cutoff), 1);
    assert.equal(cutoffWeight(level.radius + 1e-8, 'hard', level.cutoff), 0);
    assert.equal(cutoffWeight(level.radius, 'feather', level.cutoff), 0);
    assert.equal(cutoffWeight(level.radius, 'core-halo', level.cutoff), 0);
    assert.ok(Math.abs(cutoffWeight(level.radius / 2, 'feather', level.cutoff) - .5) < 1e-12);
    assert.equal(cutoffWeight(level.radius / 2, 'core-halo', level.cutoff), 1);
  }
  assert.equal(cutoffWeight(1, 'hard', 0), 0);
});

test('consensus blends selected and stricter levels, merging repeated strictest levels', () => {
  assert.deepEqual(cutoffComponents('consensus', .5), [
    { kernel: 'hard', cutoff: .5, weight: .2 }, { kernel: 'hard', cutoff: .75, weight: .3 }, { kernel: 'hard', cutoff: .9, weight: .5 },
  ]);
  assert.deepEqual(cutoffComponents('consensus', .75), [{ kernel: 'hard', cutoff: .75, weight: .2 }, { kernel: 'hard', cutoff: .9, weight: .8 }]);
  assert.deepEqual(cutoffComponents('consensus', .9), [{ kernel: 'hard', cutoff: .9, weight: 1 }]);
  assert.deepEqual(cutoffComponents('feather', .25), [{ kernel: 'feather', cutoff: .25, weight: 1 }]);
});

test('field names retain anchor IDs and reject unsupported geometry', () => {
  assert.deepEqual(cutoffFields(991, 'core-halo', .25), { coverage: 'cov_o0991_core_halo_q25', quality: 'quality_o0991_core_halo_q25' });
  assert.equal(cutoffIndexForCount(16), 'color-exploration-cutoff-16-real-v1');
  assert.throws(() => cutoffFields(0, 'consensus', .5));
  assert.throws(() => cutoffFields(1024, 'hard', .5));
  assert.throws(() => cutoffComponents('hard', .1));
  assert.throws(() => cutoffIndexForCount(32));
});
