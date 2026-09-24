import test from 'node:test';
import assert from 'node:assert/strict';
import { safeBounds, searchBounded } from './methods-bounded.mjs';
import { interpretQuery, buildQuery } from './methods.mjs';
import { INDEX, searchIndex } from './service.mjs';

test('proportion bound retains every possible winner including float-boundary ties', () => {
  const compiled = interpretQuery({ colorTargets: [{ colorName: 'green', targetImagePercent: 40 }, { colorName: 'red', targetImagePercent: 40 }] });
  const score = 1 / 1.08;
  const bounds = safeBounds(compiled, score).map(b => Object.values(b.range)[0]);
  for (let green = 0; green <= 10000; green += 50) for (let red = 0; red <= 10000; red += 50) {
    const optimistic = 1 / (1 + (Math.abs(green / 10000 - 0.4) + Math.abs(red / 10000 - 0.4)) / 2);
    if (optimistic >= score - 1e-7) {
      assert.ok(green >= bounds[0].gte && green <= bounds[0].lte);
      assert.ok(red >= bounds[1].gte && red <= bounds[1].lte);
    }
  }
});

test('bounded final search does not cap eligibility to seed document ids', async () => {
  const calls = [];
  const search = async (_index, body) => {
    calls.push(body);
    if (calls.length === 1) return { hits: [{ id: 'seed', score: 0.9 }] };
    if (calls.length === 2) return { hits: [{ id: 'seed', score: 0.8 }] };
    return { hits: [{ id: 'previously-unseen-global-winner', score: 0.95 }] };
  };
  const result = await searchBounded({ index: 'ignored', query: { text: 'red' }, limit: 1, parameters: { seedLimit: 1 }, search });
  assert.equal(result.hits[0].id, 'previously-unseen-global-winner');
  assert.equal(calls.length, 3);
  assert.doesNotMatch(JSON.stringify(calls[2]), /"seed"/);
  assert.match(JSON.stringify(calls[2]), /cov_red/);
});

test('real bounded service ordering equals complete reference top results', { skip: process.env.COLOR_EXPLORATION_METHOD_INTEGRATION !== '1' }, async () => {
  for (const query of [{ text: 'red' }, { text: 'dark' }, { colorTargets: [{ colorName: 'green', targetImagePercent: 40 }] }, { colorTargets: [{ colorName: 'grayscale', targetImagePercent: 80 }, { colorName: 'red', targetImagePercent: 20 }] }]) {
    const reference = await searchIndex(INDEX, buildQuery({ method: 'feature-composition-exact', query, limit: 20 }));
    const actual = await searchBounded({ index: INDEX, query, limit: 20, parameters: { seedLimit: 20 } });
    assert.deepEqual(actual.hits, reference.hits);
    assert.equal(actual.evidence.finalGloballyEligible, true);
  }
});
