import test from 'node:test';
import assert from 'node:assert/strict';
import { CUTOFF_QUERY_PROFILES, cutoffQueryComponents, cutoffQueryDefinition, cutoffQueryMembership } from './cutoff-blend.mjs';
import { CUTOFF_LEVELS, CUTOFF_PROFILES, cutoffComponents, cutoffDefinition, cutoffMembership } from './cutoff-definition.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';

test('all-levels includes every stored cutoff with equal defaults and positive exponential weights', () => {
  assert.equal(CUTOFF_QUERY_PROFILES.at(-1).id, 'all-levels');
  assert.deepEqual(cutoffQueryComponents('all-levels'), CUTOFF_LEVELS.map(level => ({ kernel: 'hard', cutoff: level.cutoff, weight: .2 })));
  for (const exponent of [0, .1, 1, 3, 6]) {
    const components = cutoffQueryComponents('all-levels', .9, exponent);
    assert.deepEqual(components.map(component => component.cutoff), [0, .25, .5, .75, .9]);
    assert.ok(Math.abs(components.reduce((sum, component) => sum + component.weight, 0) - 1) < 1e-12);
    assert.ok(components.every(component => component.weight > 0));
    for (let i = 1; i < components.length; i++) assert.ok(components[i].weight >= components[i - 1].weight);
    assert.ok(Math.abs(components.at(-1).weight / components[0].weight - Math.exp(exponent)) < 1e-10);
  }
  const extreme = cutoffQueryComponents('all-levels', 0, 6);
  assert.ok(extreme[0].weight < .002);
  assert.ok(extreme.at(-1).weight > .68);
  for (const invalid of [-1, 6.01, NaN, Infinity, '3', null]) assert.throws(() => cutoffQueryComponents('all-levels', 0, invalid), /cutoffBlendExponent/);
});

test('query wrappers preserve every legacy profile definition and membership exactly', () => {
  const region = overlapRegionsForCount(16)[0];
  for (const profile of CUTOFF_PROFILES) for (const { cutoff } of CUTOFF_LEVELS) {
    assert.deepEqual(cutoffQueryComponents(profile.id, cutoff), cutoffComponents(profile.id, cutoff));
    assert.deepEqual(cutoffQueryDefinition({ bucketCount: 16, profile: profile.id, cutoff }), cutoffDefinition({ bucketCount: 16, profile: profile.id, cutoff }));
    for (const distance of [0, .023, .12, .18, .239, .241]) {
      const lab = [region.lab[0] + distance, region.lab[1], region.lab[2]], options = { profile: profile.id, cutoff };
      assert.deepEqual(cutoffQueryMembership(lab, region, options), cutoffMembership(lab, region, options));
    }
  }
});

test('all-level membership shows weighted admission at each boundary without changing the quality reference', () => {
  const region = overlapRegionsForCount(16)[0], options = { profile: 'all-levels', cutoffBlendExponent: 0 };
  for (const [distance, expectedWeight] of [[0, 1], [.03, .8], [.08, .6], [.15, .4], [.22, .2], [.25, 0]]) {
    const membership = cutoffQueryMembership([region.lab[0] + distance, region.lab[1], region.lab[2]], region, options);
    assert.ok(Math.abs(membership.weight - expectedWeight) < 1e-12);
    assert.equal(membership.area, membership.weight);
    assert.ok(Math.abs(membership.quality - (expectedWeight ? 1 - distance / .24 : 0)) < 1e-12);
  }
  const definition = cutoffQueryDefinition({ bucketCount: 16, profile: 'all-levels', cutoff: .9, cutoffBlendExponent: 6 });
  assert.equal(definition.cutoff, 0);
  assert.equal(definition.radius, .24);
  assert.equal(definition.cutoffBlendExponent, 6);
  assert.equal(definition.components.length, 5);
  assert.deepEqual(definition.components, cutoffQueryComponents('all-levels', 0, 6));
});
