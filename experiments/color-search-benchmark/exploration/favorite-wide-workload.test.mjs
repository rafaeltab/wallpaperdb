import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_NAMES } from './corpus-colors.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';
import { createFavoriteUtilityPlan, supportsFavoriteUtilities } from './favorite-utilities.mjs';
import { createFavoriteWideWorkload, favoriteWideQueries, verifyFavoriteWideCoverage, FAVORITE_WIDE_DEFINITION } from './favorite-wide-workload.mjs';

test('default shuffled workload compiles to every6138 stored favorite utility key', () => {
  const workload = createFavoriteWideWorkload();
  assert.equal(workload.queries.length, 8184);
  assert.equal(workload.counts.coverageRequests, 6138);
  assert.equal(workload.counts.combinationRequests, 2046);
  assert.equal(workload.counts.combinationFraction, .25);
  const coverage = verifyFavoriteWideCoverage(workload);
  const expected = createFavoriteUtilityPlan().descriptors.map(descriptor => descriptor.key).sort();
  assert.equal(coverage.verified, true);
  assert.deepEqual(coverage.utilityKeys, expected);
  assert.equal(coverage.utilityKeys.length, 6138);
});

test('coverage sweep uses the original256 anchor hex values and23 named features with every profile', () => {
  const workload = createFavoriteWideWorkload({ combinationFraction: 0 });
  const queries = workload.queries;
  assert.equal(queries.length, (256 + 23) * 22);
  const targets = new Map();
  for (const item of queries) {
    const first = item.query.targets[0], key = first.name ? 'named:' + first.name : 'anchor:' + first.color;
    if (!targets.has(key)) targets.set(key, []);
    targets.get(key).push(item.query.mode === 'vibe' ? 'vibe' : first.percent);
    assert.equal(item.kind, 'coverage');
    assert.equal(item.parameters.namedMode, 'named-families');
    if (first.percent === 0) {
      assert.equal(item.zeroTargetWithDummy, true);
      assert.deepEqual(item.query.targets[1], { color: '#ff0000', percent: 100 });
    }
  }
  assert.deepEqual([...targets.keys()].sort(), [
    ...overlapRegionsForCount(256).map(region => 'anchor:' + region.hex), ...FEATURE_NAMES.map(name => 'named:' + name),
  ].sort());
  const profiles = ['vibe', ...Array.from({ length: 21 }, (_, i) => i * 5)].map(String).sort();
  for (const values of targets.values()) assert.deepEqual(values.map(String).sort(), profiles);
  assert.equal(queries.filter(item => item.zeroTargetWithDummy).length, 279);
});

test('seeded shuffle is deterministic and fresh, and another seed changes its order', () => {
  const a = createFavoriteWideWorkload({ seed: 123 }), b = createFavoriteWideWorkload({ seed: 123 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.queries.map(item => item.id), createFavoriteWideWorkload({ seed: 124 }).queries.map(item => item.id));
  assert.deepEqual(favoriteWideQueries({ seed: 123 }), a.queries);
  assert.equal(new Set(a.queries.map(item => item.id)).size, a.queries.length);
  a.queries[0].query.targets[0].color = '#badbad';
  assert.notDeepEqual(a.queries[0], b.queries[0]);
});

test('combination requests cover two/five targets, partial/closed palettes and vibe/proportions without off-grid inputs', () => {
  const combinations = createFavoriteWideWorkload().queries.filter(item => item.kind === 'combination');
  const shapes = new Set(), totals = new Set();
  for (const item of combinations) {
    const support = supportsFavoriteUtilities('favorite-utility-numeric', item.query, { parameters: item.parameters });
    assert.equal(support.supported, true, support.reason);
    assert.ok([2, 5].includes(item.query.targets.length));
    assert.equal(new Set(item.query.targets.map(target => target.color ? 'color:' + target.color : 'name:' + target.name)).size, item.query.targets.length);
    shapes.add(item.query.mode + ':' + item.query.targets.length);
    if (item.query.mode === 'proportions') {
      let total = 0;
      for (const target of item.query.targets) { assert.equal(target.percent % 5, 0); assert.ok(target.percent >= 0 && target.percent <= 100); total += target.percent; }
      assert.ok(total > 0 && total <= 100); totals.add(total);
    }
  }
  assert.deepEqual([...shapes].sort(), ['proportions:2', 'proportions:5', 'vibe:2', 'vibe:5']);
  assert.ok(totals.has(100)); assert.ok([...totals].some(total => total < 100));
});

test('coverage verification detects lost named-family controls or missing workload requests', () => {
  const workload = createFavoriteWideWorkload({ combinationFraction: 0 });
  assert.throws(() => verifyFavoriteWideCoverage({ ...workload, queries: workload.queries.filter(item => item.id !== 'wide-named-red-vibe') }), /missing/);
  const concrete = workload.queries.map(item => ({ ...item, parameters: { namedMode: 'concrete-swatches' } }));
  assert.throws(() => verifyFavoriteWideCoverage({ ...workload, queries: concrete }), /missing/);
});

test('workload generation never warms services and rejects unbounded or invalid options', () => {
  assert.equal(FAVORITE_WIDE_DEFINITION.requestsServices, false);
  assert.equal(FAVORITE_WIDE_DEFINITION.warmup, 'Caller-controlled; no queries are executed or warmed by this module.');
  for (const options of [{ seed: -1 }, { seed: 2 ** 32 }, { seed: .5 }, { combinationFraction: -.1 }, { combinationFraction: .51 }, { combinationFraction: NaN }]) {
    assert.throws(() => createFavoriteWideWorkload(options));
  }
});
