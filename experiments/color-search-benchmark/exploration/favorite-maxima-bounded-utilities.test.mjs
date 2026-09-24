import test from 'node:test';
import assert from 'node:assert/strict';
import { favoriteMaximaNecessaryThresholds, buildFavoriteMaximaBoundedPlan, buildFavoriteMaximaBoundedQuery,
  executeFavoriteMaximaBoundedUtilitySearch } from './favorite-maxima-bounded-utilities.mjs';
import { buildFavoriteBoundedQuery } from './favorite-bounded-utilities.mjs';

const index = 'color-exploration-maxima-test';
const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#00ff00', percent: 50 }] };
const clausesFor = n => Array.from({ length: n }, (_, i) => ({ field: 'u' + i, factor: 1 / n }));
const nativeScore = values => Math.fround(values.reduce((sum, value) => sum + Math.fround(value * Math.fround(1 / values.length)), 0));
const words = new Uint32Array(1), floats = new Float32Array(words.buffer);
const previous = value => { floats[0] = value; words[0]--; return floats[0]; };

test('necessary ranges retain all winners and ties at float32 boundaries across1..10 targets', () => {
  let seed = 99539473;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let n = 1; n <= 10; n++) for (const scale of [2 ** -149, 2 ** -126, .01, .1, .5, .9, 1]) {
    const clauses = clausesFor(n), values = clauses.map(() => Math.fround(scale));
    const maxima = Object.fromEntries(clauses.map((clause, i) => [clause.field, i % 2 ? Math.fround(scale) : 1]));
    const lower = nativeScore(values), result = favoriteMaximaNecessaryThresholds({ clauses, maxima, kthSeedScore: lower });
    assert.equal(result.fallback, lower === 0 ? 'zero-lower-bound' : null);
    for (const { field, threshold } of result.thresholds) {
      const i = clauses.findIndex(clause => clause.field === field);
      assert.ok(threshold > 0 && threshold <= maxima[field]);
      const atPrevious = clauses.map(clause => clause.field === field ? previous(threshold) : maxima[clause.field]);
      assert.ok(nativeScore(atPrevious) < Math.fround(lower));
      assert.ok(values[i] >= threshold);
    }
    for (let attempt = 0; attempt < 100; attempt++) {
      const sample = clauses.map(clause => Math.fround(maxima[clause.field] * random()));
      if (nativeScore(sample) >= Math.fround(lower)) for (const { field, threshold } of result.thresholds) assert.ok(sample[clauses.findIndex(c => c.field === field)] >= threshold);
    }
  }
});

test('unequal global maxima tighten both necessary ranges and unsafe inputs never narrow', () => {
  const clauses = clausesFor(2), maxima = { u0: 1, u1: Math.fround(.8) };
  const result = favoriteMaximaNecessaryThresholds({ clauses, maxima, kthSeedScore: .85 });
  assert.equal(result.fallback, null); assert.equal(result.thresholds.length, 2);
  assert.ok(Math.abs(result.thresholds[0].threshold - .9) < 1e-6);
  assert.ok(Math.abs(result.thresholds[1].threshold - .7) < 1e-6);
  assert.deepEqual(favoriteMaximaNecessaryThresholds({ clauses, maxima: { u0: .1, u1: .1 }, kthSeedScore: .9 }), { thresholds: [], fallback: 'inconsistent-maxima' });
  assert.equal(favoriteMaximaNecessaryThresholds({ clauses: [{ field: 'u0', factor: .5 }, { field: 'u0', factor: .5 }], maxima: { u0: 1 }, kthSeedScore: .4 }).fallback, 'duplicate-utility-fields');
  for (const invalid of [NaN, Infinity, -1, 1.01, undefined]) assert.throws(() => favoriteMaximaNecessaryThresholds({ clauses, maxima: { ...maxima, u1: invalid }, kthSeedScore: .5 }), /maxim/i);
  assert.throws(() => favoriteMaximaNecessaryThresholds({ clauses, maxima, kthSeedScore: NaN }), /lower bound/i);
  assert.equal(favoriteMaximaNecessaryThresholds({ clauses: [{ field: 'u0', factor: .7 }, { field: 'u1', factor: .3 }], maxima, kthSeedScore: .5 }).fallback, 'unsupported-clause-factors');
});

test('random unequal maxima preserve the entire winning region including its nearest float32 predecessor', () => {
  let seed = 38621873;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const n of [2, 3, 5, 10]) for (let fixture = 0; fixture < 50; fixture++) {
    const clauses = clausesFor(n), peaks = clauses.map(() => Math.fround(random())), maxima = Object.fromEntries(clauses.map((clause, i) => [clause.field, peaks[i]]));
    for (const ratio of [.1, .5, .9, 1]) {
      const lower = Math.fround(nativeScore(peaks) * ratio), result = favoriteMaximaNecessaryThresholds({ clauses, maxima, kthSeedScore: lower });
      assert.equal(result.fallback, null);
      for (const { field, threshold } of result.thresholds) {
        const position = clauses.findIndex(clause => clause.field === field), boundary = [...peaks];
        boundary[position] = previous(threshold);
        assert.ok(nativeScore(boundary) < lower, 'Every below-threshold value loses even with every other field at its global maximum');
      }
      for (let sample = 0; sample < 20; sample++) {
        const values = peaks.map(peak => Math.fround(peak * random()));
        if (nativeScore(values) >= lower) for (const { field, threshold } of result.thresholds) assert.ok(values[clauses.findIndex(clause => clause.field === field)] >= threshold);
      }
    }
  }
});

test('negative zero maxima normalize to the positive float32 search domain', () => {
  const clauses = clausesFor(2);
  for (const lower of [0, 2 ** -149, .4, .5]) assert.deepEqual(
    favoriteMaximaNecessaryThresholds({ clauses, maxima: { u0: -0, u1: 1 }, kthSeedScore: lower }),
    favoriteMaximaNecessaryThresholds({ clauses, maxima: { u0: 0, u1: 1 }, kthSeedScore: lower }));
});

const response = (hits, extra = {}) => ({ wallMs: 1, body: { took: 1, timed_out: false, _shards: { failed: 0 },
  hits: { hits: hits.map(([id, score, utility]) => ({ fields: { id: [id] }, _score: score, ...(utility === undefined ? {} : { sort: [utility, id] }) })) }, ...extra } });
function fakeRequest(searches) {
  const calls = [];
  const request = async (route, options) => {
    calls.push({ route, ...options });
    if (route.includes('/_search/point_in_time?')) return { wallMs: 1, body: { pit_id: 'snapshot-1', _shards: { failed: 0 } } };
    if (options.method === 'DELETE') return { wallMs: 1, body: { pits: options.body.pit_id.map(pit_id => ({ pit_id, successful: true })) } };
    const next = searches.shift(); if (next instanceof Error) throw next;
    assert.ok(next, 'Unexpected search'); return next;
  };
  return { calls, request };
}

test('same PIT and filters supply global maxima; final unchanged numeric score uses OR plus AND ranges', async () => {
  const fake = fakeRequest([response([['a', null, 1], ['b', null, .9]]), response([['c', null, .8], ['b', null, .7]]),
    response([['a', .9], ['b', .85]]), response([['outside-seeds', .91], ['a', .9]])]);
  const options = { index, query, limit: 2, eligibleIds: ['a', 'b', 'c', 'outside-seeds'], excludedIds: ['excluded'], filter: { term: { partition: 3 } } };
  const parent = buildFavoriteBoundedQuery(options), plan = buildFavoriteMaximaBoundedPlan(options);
  assert.deepEqual(buildFavoriteMaximaBoundedQuery(options), parent);
  const result = await executeFavoriteMaximaBoundedUtilitySearch({ ...options, request: fake.request });
  assert.deepEqual(result.hits, [{ id: 'outside-seeds', score: .91 }, { id: 'a', score: .9 }]);
  const searches = fake.calls.filter(call => call.route.startsWith('_search?'));
  assert.equal(searches.length, 4); assert.equal(result.evidence.requestCount, 6);
  for (const call of searches) {
    assert.deepEqual(call.body.pit, { id: 'snapshot-1' });
    assert.deepEqual(call.body.query.bool.filter.slice(0, parent.query.bool.filter.length), parent.query.bool.filter);
    assert.equal(call.body.stored_fields, '_none_'); assert.deepEqual(call.body.docvalue_fields, ['id']);
  }
  const final = searches.at(-1).body;
  assert.deepEqual(final.query.bool.should, parent.query.bool.should);
  const extra = final.query.bool.filter.slice(parent.query.bool.filter.length);
  assert.equal(extra[0].bool.minimum_should_match, 1); assert.equal(extra[0].bool.should.length, 2);
  assert.equal(extra.slice(1).length, 2); assert.ok(extra.slice(1).every(item => item.range));
  assert.deepEqual(result.evidence.globalBounds.maximaBounds.maxima, { [plan.fields[0]]: 1, [plan.fields[1]]: Math.fround(.8) });
  assert.equal(result.evidence.globalBounds.maximaBounds.fallback, null); assert.equal(result.evidence.globalBounds.maximaBounds.addedRanges, 2);
  assert.equal(fake.calls.at(-1).method, 'DELETE');
});

test('duplicate anchors preserve duplicate score terms and fall back to the original OR bound', async () => {
  const duplicated = { mode: 'vibe', targets: [{ color: '#ff0000' }, { color: '#ff0000' }] };
  const plan = buildFavoriteMaximaBoundedPlan({ query: duplicated, limit: 1 });
  assert.equal(plan.fields.length, 1); assert.equal(plan.targetCount, 2); assert.equal(plan.numericBody.query.bool.should.length, 2);
  const fake = fakeRequest([response([['a', null, 1]]), response([['a', .4]]), response([['a', .4]])]);
  const result = await executeFavoriteMaximaBoundedUtilitySearch({ index, query: duplicated, limit: 1, request: fake.request });
  assert.equal(result.evidence.globalBounds.maximaBounds.fallback, 'duplicate-utility-fields');
  assert.equal(result.evidence.globalBounds.maximaBounds.addedRanges, 0);
  assert.equal(fake.calls.at(-2).body.query.bool.filter.length, plan.numericBody.query.bool.filter.length + 1);
  const closeColors = buildFavoriteMaximaBoundedPlan({ query: { mode: 'vibe', targets: [{ color: '#ff0000' }, { color: '#ff0100' }] } });
  assert.equal(closeColors.fields.length, 1); assert.equal(closeColors.targetCount, 2);
});

test('zero bounds and too few seeds keep the original full query including zero-score ties', async () => {
  for (const zero of [true, false]) {
    const seeds = zero ? [response([['a', null, 1]]), response([['b', null, 1]])] : [response([]), response([])];
    const fake = fakeRequest([...seeds, ...(zero ? [response([['a', 0], ['b', 0]])] : []), response(zero ? [['a', 0], ['b', 0]] : [])]);
    const result = await executeFavoriteMaximaBoundedUtilitySearch({ index, query, limit: 2, request: fake.request });
    assert.deepEqual(fake.calls.at(-2).body.query, buildFavoriteBoundedQuery({ query, limit: 2 }).query);
    assert.equal(result.evidence.globalBounds.fallback, zero ? 'zero-lower-bound' : 'fewer-than-limit-seeds');
    assert.equal(result.evidence.globalBounds.maximaBounds.addedRanges, 0);
  }
});

test('inconsistent observed maxima conservatively retain only the original bound', async () => {
  const fake = fakeRequest([response([['a', null, .1]]), response([['b', null, .1]]), response([['a', .9]]), response([['a', .9]])]);
  const result = await executeFavoriteMaximaBoundedUtilitySearch({ index, query, limit: 1, request: fake.request });
  assert.equal(result.evidence.globalBounds.maximaBounds.fallback, 'inconsistent-maxima');
  assert.equal(result.evidence.globalBounds.maximaBounds.addedRanges, 0);
  assert.equal(fake.calls.at(-2).body.query.bool.filter.length, buildFavoriteBoundedQuery({ query, limit: 1 }).query.bool.filter.length + 1);
});

test('service caps and total deadlines include all searches and cleanup', async () => {
  let clock = 0;
  const fake = fakeRequest([response([['a', null, 1], ['b', null, .9]]), response([['c', null, .8], ['b', null, .7]]),
    response([['a', .9], ['b', .85]]), response([['a', .9], ['b', .85]])]);
  const request = async (route, options) => { const value = await fake.request(route, options); if (route.startsWith('_search?')) clock += 250; return value; };
  await executeFavoriteMaximaBoundedUtilitySearch({ index, query, limit: 2, request, now: () => clock, timeoutMs: 1500, serviceTimeout: '950ms' });
  const searches = fake.calls.filter(call => call.route.startsWith('_search?'));
  assert.deepEqual(searches.map(call => call.body.timeout), ['950ms', '950ms', '899ms', '649ms']);
  assert.deepEqual(searches.map(call => call.timeoutMs), [1400, 1150, 900, 650]);
  assert.equal(fake.calls.at(-1).timeoutMs, 500);
  for (const serviceTimeout of ['0ms', 'bad', '0.5s', 950, '999nanos']) await assert.rejects(executeFavoriteMaximaBoundedUtilitySearch({ index, query, serviceTimeout,
    request: () => assert.fail('Must reject before opening a PIT') }), /serviceTimeout/);
});

test('partial stages, late PIT creation, rotated IDs and cleanup failures preserve original lifecycle safeguards', async () => {
  const partial = fakeRequest([response([], { timed_out: true })]);
  await assert.rejects(executeFavoriteMaximaBoundedUtilitySearch({ index, query, request: partial.request }), /timed out/);
  assert.equal(partial.calls.at(-1).method, 'DELETE');
  for (const late of [true, false]) {
    let clock = 0; const fake = fakeRequest([]);
    const request = async (route, options) => { const value = await fake.request(route, options); if (options.method === 'POST') { if (late) clock = 95; else value.body._shards.failed = 1; } return value; };
    await assert.rejects(executeFavoriteMaximaBoundedUtilitySearch({ index, query, request, timeoutMs: 100, now: () => clock }), /deadline|complete OpenSearch PIT/);
    assert.equal(fake.calls.at(-1).method, 'DELETE');
  }
  const rotated = fakeRequest([response([], { pit_id: 'snapshot-2' }), response([]), response([])]);
  await executeFavoriteMaximaBoundedUtilitySearch({ index, query, request: rotated.request });
  assert.deepEqual(rotated.calls.at(-1).body.pit_id, ['snapshot-1', 'snapshot-2']);
  const broken = fakeRequest([response([]), response([]), response([])]);
  const request = async (route, options) => { const value = await broken.request(route, options); if (options.method === 'DELETE') value.body.pits[0].successful = false; return value; };
  await assert.rejects(executeFavoriteMaximaBoundedUtilitySearch({ index, query, request }), error => {
    assert.equal(error.evidence.stages.at(-1).phase, 'pit-close-error'); return /cleanup/.test(error.message);
  });
});

test('invalid or unsorted seed maxima fail with PIT cleanup rather than applying unsafe bounds', async () => {
  for (const seed of [response([['a', null]]), response([['a', null, NaN]]), response([['a', null, 1.1]]), response([['a', null, .3], ['b', null, .8]])]) {
    const fake = fakeRequest([seed]);
    await assert.rejects(executeFavoriteMaximaBoundedUtilitySearch({ index, query, request: fake.request }), /seed|sort|maxim/i);
    assert.equal(fake.calls.at(-1).method, 'DELETE');
  }
});
