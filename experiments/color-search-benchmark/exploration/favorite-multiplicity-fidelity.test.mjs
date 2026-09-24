import test from 'node:test';
import assert from 'node:assert/strict';
import { multiplicityCases, multiplicityOracle, assertMultiplicityRanking, readMultiplicityValues, multiplicityFidelityConfiguration } from './favorite-multiplicity-fidelity.mjs';
import { buildFavoriteDocvalueQuery } from './favorite-docvalue-fetch.mjs';

const body = buildFavoriteDocvalueQuery({ query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 20 }, { color: '#ff0000', percent: 20 }, { color: '#0000ff', percent: 20 }] } });
const fields = body.query.bool.should.map(term => term.function_score.field_value_factor.field);
test('independent oracle retains target multiplicity and separates requested proportions', () => {
  const result = multiplicityOracle(body, [{ id: 'b', values: { [fields[0]]: .9, [fields[2]]: .3 } }, { id: 'a', values: { [fields[0]]: .3, [fields[2]]: .9 } }]);
  assert.deepEqual(result.hits.map(hit => hit.id), ['b', 'a']);
  assert.ok(Math.abs(result.hits[0].score - .7) < 1e-7); assert.ok(Math.abs(result.hits[1].score - .5) < 1e-7);
  assert.ok(result.maxIdealMeanError < 1e-7);
  assert.equal(multiplicityCases().find(row => row.id === 'red-different-amounts').expectedGroups, 2);
});

test('oracle exact float32 scores, service tie order and complete eligibility are checked', () => {
  const rows = [{ id: 'b', values: { [fields[0]]: 0, [fields[2]]: 0 } }, { id: 'a', values: { [fields[0]]: 0, [fields[2]]: 0 } }];
  const expected = multiplicityOracle(body, rows).hits; assert.deepEqual(expected.map(hit => hit.id), ['a', 'b']);
  assert.doesNotThrow(() => assertMultiplicityRanking(expected, expected));
  assert.throws(() => assertMultiplicityRanking(expected, [...expected].reverse()), /order/);
  assert.throws(() => assertMultiplicityRanking(expected, [{ id: 'a', score: .1 }, expected[1]]), /score/);
  assert.throws(() => assertMultiplicityRanking(expected, expected.slice(1)), /count/);
});

test('raw doc values require complete single-valued finite numeric utilities and exact corpus IDs', () => {
  const requested = [...new Set(fields)], ids = ['a', 'b'];
  const response = { hits: { total: { value: 2, relation: 'eq' }, hits: ids.map(id => ({ _id: id, fields: { id: [id], ...Object.fromEntries(requested.map(field => [field, [.25]])) } })) } };
  assert.equal(readMultiplicityValues(response, { ids, fields: requested }).length, 2);
  for (const mutate of [x => { x.timed_out = true; }, x => { x.hits.hits[0].fields.id.push('x'); }, x => { x.hits.hits[0].fields[fields[0]] = [.1, .2]; }, x => { delete x.hits.hits[0].fields[fields[0]]; }, x => { x.hits.total.relation = 'gte'; }]) {
    const changed = structuredClone(response); mutate(changed); assert.throws(() => readMultiplicityValues(changed, { ids, fields: requested }));
  }
});

test('fidelity configuration requires a new external directory and scratch index', () => {
  assert.throws(() => multiplicityFidelityConfiguration([]));
  assert.throws(() => multiplicityFidelityConfiguration(['--directory', process.cwd()]));
  assert.throws(() => multiplicityFidelityConfiguration(['--directory', '/tmp/proof', '--index', 'production']));
  assert.equal(multiplicityFidelityConfiguration(['--directory', '/tmp/proof']).index, 'color-exploration-favorite-points-real-v2');
});
