import test from 'node:test';
import assert from 'node:assert/strict';
import { favoriteBoundedThreshold, buildFavoriteBoundedPlan, buildFavoriteBoundedQuery, executeFavoriteBoundedUtilitySearch } from './favorite-bounded-utilities.mjs';

const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#00ff00', percent: 50 }] };
const index = 'color-exploration-bounded-test';
const score = values => Math.fround(values.reduce((sum, value) => sum + Math.fround(Math.fround(value) * Math.fround(1 / values.length)), 0));
const words = new Uint32Array(1), floats = new Float32Array(words.buffer);
const shift = (value, count) => { floats[0] = value; words[0] += count; return floats[0]; };

test('safe threshold retains every possible winner around float32 rounding boundaries and tiny scores', () => {
  let seed = 99539473;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let n = 1; n <= 10; n++) for (const center of [2 ** -149, 2 ** -126, 0.01, 0.1, 0.5, 0.9, 1]) {
    const lowerBound = score(Array(n).fill(center)), threshold = favoriteBoundedThreshold(lowerBound, n);
    assert.ok(threshold === null || threshold > 0 && threshold <= 1);
    if (threshold === null) continue;
    assert.ok(score(Array(n).fill(shift(threshold, -1))) < Math.fround(lowerBound));
    for (let i = 0; i < 100; i++) {
      const values = Array.from({ length: n }, () => Math.fround(random()));
      if (score(values) >= Math.fround(lowerBound)) assert.ok(values.some(value => value >= threshold));
    }
    assert.ok(Array(n).fill(Math.fround(center)).some(value => value >= threshold));
  }
  assert.equal(favoriteBoundedThreshold(0, 2), null);
  assert.throws(() => favoriteBoundedThreshold(NaN, 2));
  assert.throws(() => favoriteBoundedThreshold(.5, 11));
});

const response = (hits, extra = {}) => ({ wallMs: 1, body: { took: 1, timed_out: false, _shards: { total: 1, successful: 1, failed: 0 },
  hits: { hits: hits.map(([id, score]) => ({ fields: { id: [id] }, _score: score })) }, ...extra } });
function fakeRequest(searches) {
  const calls = [];
  const request = async (route, options) => {
    calls.push({ route, ...options });
    if (route.includes('/_search/point_in_time?')) return { wallMs: 1, body: { pit_id: 'snapshot-1', _shards: { total: 1, successful: 1, failed: 0 } } };
    if (options.method === 'DELETE') return { wallMs: 1, body: { pits: [{ pit_id: 'snapshot-1', successful: true }] } };
    const next = searches.shift(); if (next instanceof Error) throw next;
    assert.ok(next, 'Unexpected extra search'); return next;
  };
  return { calls, request };
}

test('PIT seeds and lower bound preserve filters; final query globally scores all bound-eligible documents', async () => {
  const seed = response([['a', null], ['b', null]]), final = response([['global-winner', .9], ['b', .8]]);
  const fake = fakeRequest([seed, response([['c', null], ['b', null]]), response([['b', .8], ['a', .7]]), final]);
  const options = { index, query, limit: 2, filter: { term: { partition: 4 } }, excludedIds: ['excluded'] };
  const original = buildFavoriteBoundedQuery(options);
  const result = await executeFavoriteBoundedUtilitySearch({ ...options, request: fake.request });
  assert.deepEqual(result.hits, [{ id: 'global-winner', score: .9 }, { id: 'b', score: .8 }]);
  const searches = fake.calls.filter(call => call.route.startsWith('_search?'));
  assert.equal(searches.length, 4);
  for (const call of searches) {
    assert.deepEqual(call.body.query.bool.filter[0], original.query.bool.filter[0]);
    assert.deepEqual(call.body.pit, { id: 'snapshot-1' });
    assert.equal(call.body.stored_fields, '_none_');
    assert.deepEqual(call.body.docvalue_fields, ['id']);
  }
  assert.equal(searches[0].body.track_scores, false);
  assert.deepEqual(searches[2].body.query.bool.filter.at(-1), { ids: { values: ['a', 'b', 'c'] } });
  assert.deepEqual(searches[3].body.query.bool.should, original.query.bool.should);
  assert.equal(searches[3].body.query.bool.filter.at(-1).bool.minimum_should_match, 1);
  assert.equal(searches[3].body.query.bool.filter.at(-1).bool.should.length, 2);
  assert.equal(result.evidence.globalBounds.completeCandidateCoverage, true);
  assert.equal(result.evidence.globalBounds.seedUnionCount, 3);
  assert.equal(fake.calls.at(-1).method, 'DELETE');
  assert.deepEqual(fake.calls.at(-1).body, { pit_id: ['snapshot-1'] });
});

test('zero lower bound falls back to full numeric query and retains zero-score ties', async () => {
  const fake = fakeRequest([response([['a', null]]), response([['b', null]]), response([['a', 0], ['b', 0]]), response([['a', 0], ['b', 0]])]);
  const result = await executeFavoriteBoundedUtilitySearch({ index, query, limit: 2, request: fake.request });
  const final = fake.calls.at(-2).body;
  assert.deepEqual(final.query, buildFavoriteBoundedQuery({ query, limit: 2 }).query);
  assert.equal(result.evidence.globalBounds.threshold, null);
  assert.equal(result.evidence.globalBounds.fallback, 'zero-lower-bound');
});

test('duplicate utility targets deduplicate seed/filter work, never native score terms', () => {
  const duplicated = { mode: 'vibe', targets: [{ color: '#ff0000' }, { color: '#ff0000' }] };
  const plan = buildFavoriteBoundedPlan({ query: duplicated });
  assert.equal(plan.fields.length, 1);
  assert.equal(plan.targetCount, 2);
  assert.equal(plan.numericBody.query.bool.should.length, 2);
});

test('PIT closes after partial-search rejection and enforces the remaining total deadline', async () => {
  const bad = fakeRequest([response([], { timed_out: true })]);
  await assert.rejects(executeFavoriteBoundedUtilitySearch({ index, query, request: bad.request }), /timed out/);
  assert.equal(bad.calls.at(-1).method, 'DELETE');
  let clock = 0;
  const slow = fakeRequest([response([['a', null]])]);
  const request = async (route, options) => { const result = await slow.request(route, options); if (route.startsWith('_search?')) clock += 95; return result; };
  await assert.rejects(executeFavoriteBoundedUtilitySearch({ index, query, request, timeoutMs: 100, now: () => clock }), /deadline/);
  assert.equal(slow.calls.at(-1).method, 'DELETE');
  assert.ok(slow.calls.at(-1).timeoutMs <= 5);
});

test('late PIT creation and partial PIT creation both retain the ID for cleanup', async () => {
  for (const late of [true, false]) {
    let clock = 0;
    const fake = fakeRequest([]);
    const request = async (route, options) => {
      const result = await fake.request(route, options);
      if (options.method === 'POST') {
        if (late) clock = 95;
        else result.body._shards.failed = 1;
      }
      return result;
    };
    await assert.rejects(executeFavoriteBoundedUtilitySearch({ index, query, request, timeoutMs: 100, now: () => clock }), /deadline|complete OpenSearch PIT/);
    assert.equal(fake.calls.at(-1).method, 'DELETE');
  }
});

test('failed PIT cleanup is an explicit failed request with evidence', async () => {
  const fake = fakeRequest([response([]), response([]), response([])]);
  const request = async (route, options) => {
    const result = await fake.request(route, options);
    if (options.method === 'DELETE') result.body.pits[0].successful = false;
    return result;
  };
  await assert.rejects(executeFavoriteBoundedUtilitySearch({ index, query, request }), error => {
    assert.match(error.message, /cleanup/);
    assert.equal(error.evidence.stages.at(-1).phase, 'pit-close-error');
    return true;
  });
});

test('every search stage obeys the service cap and the shrinking total budget', async () => {
  let clock = 0;
  const fake = fakeRequest([response([['a', null], ['b', null]]), response([['c', null], ['b', null]]),
    response([['a', .8], ['b', .7]]), response([['a', .8], ['b', .7]])]);
  const request = async (route, options) => {
    const result = await fake.request(route, options);
    if (route.startsWith('_search?')) clock += 250;
    return result;
  };
  await executeFavoriteBoundedUtilitySearch({ index, query, limit: 2, request, now: () => clock, timeoutMs: 1500, serviceTimeout: '950ms' });
  const searches = fake.calls.filter(call => call.route.startsWith('_search?'));
  assert.deepEqual(searches.map(call => call.body.timeout), ['950ms', '950ms', '899ms', '649ms']);
  assert.deepEqual(searches.map(call => call.timeoutMs), [1400, 1150, 900, 650]);
  assert.equal(fake.calls.at(-1).timeoutMs, 500);
});

test('service duration is parsed before opening a PIT and does not change the total deadline', async () => {
  const fake = fakeRequest([response([]), response([]), response([])]);
  await executeFavoriteBoundedUtilitySearch({ index, query, request: fake.request, timeoutMs: 1500, serviceTimeout: '1s', now: () => 0 });
  assert.ok(fake.calls.filter(call => call.route.startsWith('_search?')).every(call => call.body.timeout === '1000ms' && call.timeoutMs === 1400));
  for (const serviceTimeout of ['0ms', 'bad', '0.5s', 950, '999nanos']) {
    await assert.rejects(executeFavoriteBoundedUtilitySearch({ index, query, serviceTimeout, request: () => assert.fail('must validate before opening a PIT') }), /serviceTimeout/);
  }
});
