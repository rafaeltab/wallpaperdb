import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAP_METHODS, supportsOverlap, resolveOverlapTargets, buildOverlapQuery, overlapParameters } from './methods-overlap.mjs';
import { OVERLAP_REGIONS, regionFields } from './overlap-regions.mjs';
import { OVERLAP_BUCKET_COUNTS, overlapRegionsForCount, overlapIndexForCount } from './overlap-banks.mjs';
import { indexForMethod } from './registry.mjs';
import { createCandidate } from './adapter.mjs';
import { api, bulkIndex, createIndex, finishIndex, searchIndex } from './service.mjs';

const dense = 'overlap-quality-dense';
const hybrid = 'overlap-quality-hybrid';
const partial = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 40 }] };

test('bucket count accepts only the four numeric variants and defaults to unchanged 1024 queries', () => {
  for (const method of OVERLAP_METHODS) {
    assert.equal(overlapParameters(method).bucketCount, 1024);
    for (const bucketCount of OVERLAP_BUCKET_COUNTS) assert.equal(overlapParameters(method, { bucketCount }).bucketCount, bucketCount);
    for (const bucketCount of [0, 15, 32, 1025, 16.5, '16', null, NaN, Infinity]) {
      assert.throws(() => overlapParameters(method, { bucketCount }), /bucketCount/);
      assert.throws(() => resolveOverlapTargets(method, partial, { parameters: { bucketCount } }), /bucketCount/);
    }
    for (const query of [partial, { text: 'red' }, { text: 'dark' }]) assert.deepEqual(
      buildOverlapQuery({ method, query }), buildOverlapQuery({ method, query, parameters: { bucketCount: 1024 } }),
    );
  }
});

test('each count resolves only its own anchors while preserving native scoring and original field identities', () => {
  for (const bucketCount of OVERLAP_BUCKET_COUNTS) {
    const bank = overlapRegionsForCount(bucketCount), parameters = { bucketCount, qualityInfluence: 2, minimumQuality: .7 };
    for (const method of OVERLAP_METHODS) {
      // Exact swatches prove sparse original IDs do not become bank offsets.
      const anchor = bank.at(-1), query = { mode: 'proportions', targets: [{ color: anchor.hex, percent: 40 }] };
      const resolved = resolveOverlapTargets(method, query, { parameters });
      assert.equal(resolved.targets[0].regionIndex, anchor.index);
      assert.equal(resolved.targets[0].anchorDistance, 0);
      assert.equal(resolved.targets[0].coverageField, regionFields(anchor.index).coverage);
      const body = buildOverlapQuery({ method, query, parameters });
      const original = buildOverlapQuery({ method, query, parameters: { ...parameters, bucketCount: 1024 } });
      assert.deepEqual(body, original, 'The same anchor must retain exactly the same scoring functions.');
      assert.ok(!JSON.stringify(body).includes('script'));
      assert.equal(indexForMethod(method, undefined, parameters), overlapIndexForCount(bucketCount));
      assert.equal(indexForMethod(method, 'explicit-scratch-index', parameters), 'explicit-scratch-index');
    }
    const named = resolveOverlapTargets(hybrid, { text: 'red' }, { parameters });
    assert.equal(named.targets[0].coverageField, 'cov_red', 'Hybrid named families stay count-independent.');
  }
});

test('smaller banks quantize an omitted color to an available region rather than reading unindexed fields', () => {
  for (const bucketCount of OVERLAP_BUCKET_COUNTS.filter(value => value < 1024)) {
    const bankIds = new Set(overlapRegionsForCount(bucketCount).map(region => region.index));
    const omitted = OVERLAP_REGIONS.find(region => !bankIds.has(region.index));
    const query = { targets: [{ color: omitted.hex }] };
    const selected = resolveOverlapTargets(dense, query, { parameters: { bucketCount } }).targets[0];
    assert.ok(bankIds.has(selected.regionIndex));
    assert.notEqual(selected.regionIndex, omitted.index);
    assert.ok(selected.anchorDistance > 0);
    const body = buildOverlapQuery({ method: dense, query, parameters: { bucketCount } });
    assert.match(JSON.stringify(body), new RegExp(selected.coverageField));
    assert.ok(!JSON.stringify(body).includes(regionFields(omitted.index).coverage));
  }
});

test('feedback adapter verifies and searches the count-specific physical index with recorded parameters', async () => {
  for (const bucketCount of OVERLAP_BUCKET_COUNTS) {
    const calls = [], parameters = { bucketCount, qualityInfluence: 2, minimumQuality: .7 };
    const verify = async request => { calls.push(request); return { completeIdsVerified: true, count: 1 }; };
    const candidate = await createCandidate({ config: { id: `overlap-${bucketCount}`, method: dense, parameters }, context: { corpus: [{ id: 'wallpaper-001' }] } }, {
      verifyOverlapIndex: request => { assert.equal(bucketCount, 1024); return verify(request); },
      verifyOverlapBucketIndex: request => { assert.notEqual(bucketCount, 1024); assert.equal(request.bucketCount, bucketCount); return verify(request); },
      api: async () => ({ body: { version: { number: 'test' } } }),
      executeSearch: async request => { calls.push(request); return { hits: [], evidence: {} }; },
    });
    await candidate.prepare();
    await candidate.search({ caseData: { query: partial }, limit: 3 });
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.index === overlapIndexForCount(bucketCount)));
    assert.deepEqual(calls[1].parameters, parameters);
    assert.equal(candidate.metadata.bucketCount, bucketCount);
    assert.equal(candidate.metadata.representation, `overlap-coverage-quality-${bucketCount}`);
    assert.ok(candidate.metadata.label.includes(bucketCount.toLocaleString('en-US')));
    assert.ok(candidate.metadata.sourceFiles.includes('exploration/overlap-banks.mjs'));
    assert.ok(candidate.metadata.sourceFiles.includes('exploration/overlap-bucket-index.mjs'));
  }
});

test('dense versus hybrid isolates the interpretation of concrete named colors', () => {
  const query = { mode: 'proportions', targets: [{ name: 'red', percent: 20 }, { name: 'grayscale', percent: 80 }] };
  const a = resolveOverlapTargets(dense, query), b = resolveOverlapTargets(hybrid, query);
  assert.equal(a.targets[0].kind, 'region');
  assert.equal(a.targets[1].kind, 'named');
  assert.equal(b.targets[0].kind, 'named');
  assert.equal(b.targets[1].kind, 'named');
  assert.equal(a.targets[0].anchorDistance, 0);
  assert.equal(a.targets[1].coverageField, 'cov_grayscale');
  assert.ok(a.warnings.some(value => /literal/i.test(value)));
});

test('picked colors use one nearest region and preserve amount separately from quality', () => {
  for (const method of OVERLAP_METHODS) {
    const resolved = resolveOverlapTargets(method, partial);
    const target = resolved.targets[0], anchor = OVERLAP_REGIONS[target.regionIndex];
    assert.equal(target.kind, 'region');
    assert.equal(target.amount, .4);
    assert.equal(target.regionHex, anchor.hex);
    assert.equal(target.coverageField, regionFields(anchor.index).coverage);
    assert.equal(target.qualityField, regionFields(anchor.index).quality);
    assert.ok(target.anchorDistance >= 0 && target.anchorDistance < .08);
    assert.equal(resolved.targets.length, 1, 'Overlapping neighbor areas are never summed.');
  }
});

test('fixed bank accepts its exact range and rejects controls it did not index', () => {
  for (const method of OVERLAP_METHODS) {
    for (const query of [partial, { swatchHex: '#ff2200' }, { targets: [{ color: '#ff2200', ranges: [{ space: 'oklab', distance: .12 }], edgeWeight: .5 }] }]) {
      assert.equal(supportsOverlap(method, query).supported, true);
    }
    for (const target of [
      { color: '#ff2200', distance: .2 },
      { color: '#ff2200', edgeWeight: .7 },
      { color: '#ff2200', ranges: [] },
      { color: '#ff2200', ranges: [{ space: 'rgb', r: .2, g: .2, b: .2 }] },
      { name: 'red', edgeWeight: .7 },
    ]) assert.equal(supportsOverlap(method, { targets: [target] }).supported, false, JSON.stringify(target));
    assert.equal(supportsOverlap(method, { text: 'grayscale with red' }).supported, false);
    assert.equal(supportsOverlap(method, { text: 'dark with bright spots' }).supported, false);
  }
});

test('explicit radius on named queries uses a region in both variants', () => {
  const query = { targets: [{ name: 'red', tolerance: { distance: .12 } }] };
  assert.equal(resolveOverlapTargets(hybrid, query).targets[0].kind, 'region');
});

test('native query scores eligible documents globally and has no ranking script', () => {
  const body = buildOverlapQuery({ method: dense, query: partial, limit: 7, eligibleIds: ['a', 'b'], excludedIds: ['b'], filter: { term: { cohort: 'real' } } });
  assert.equal(body.size, 7);
  assert.equal(body._source, false);
  assert.deepEqual(body.sort, [{ _score: 'desc' }, { id: 'asc' }]);
  assert.ok(!JSON.stringify(body).includes('script'));
  assert.match(JSON.stringify(body.query.bool.filter), /"values":\["a","b"\]/);
  assert.match(JSON.stringify(body.query.bool.filter), /"must_not":\[\{"ids":\{"values":\["b"\]/);
  assert.match(JSON.stringify(body.query.bool.filter), /"cohort":"real"/);
  const target = resolveOverlapTargets(dense, partial).targets[0];
  const functions = body.query.bool.should[0].function_score.functions;
  assert.equal(functions[0].linear[target.coverageField].scale, 5000);
  assert.equal(functions[1].linear[target.coverageField].scale, 5000 / 1.5);
  assert.deepEqual(functions[0].filter, { range: { [target.coverageField]: { lte: 4000 } } });
  assert.deepEqual(functions[1].filter, { range: { [target.coverageField]: { gt: 4000 } } });
});

test('multiple targets remain marginal areas and closed palettes disclose omitted purity', () => {
  const query = { mode: 'proportions', overlap: 'marginal', targets: [{ color: '#ff2200', percent: 70 }, { color: '#f02000', percent: 70 }] };
  const resolved = resolveOverlapTargets(dense, query);
  assert.equal(resolved.targets.length, 2);
  assert.ok(resolved.warnings.some(value => /overlap/i.test(value)));
  assert.ok(resolved.warnings.some(value => /purity/i.test(value)));
  const body = buildOverlapQuery({ method: dense, query });
  assert.equal(body.query.bool.should.length, 2);
  for (const clause of body.query.bool.should) assert.deepEqual(clause.function_score.functions.at(-1), { weight: .5 });
});

test('zero desired area ignores quality and unsupported parameters fail early', () => {
  const query = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 0 }, { name: 'green', percent: 40 }] };
  const target = resolveOverlapTargets(dense, query).targets[0];
  const body = buildOverlapQuery({ method: dense, query });
  assert.ok(!JSON.stringify(body.query.bool.should[0]).includes(target.qualityField));
  for (const parameters of [{ areaPower: .65 }, { qualityPenalty: 1.2 }, { excessPenalty: 0 }, { other: 1 }]) assert.throws(() => overlapParameters(dense, parameters));
});

test('quality influence is validated and defaults to the previous scoring weight', () => {
  assert.equal(overlapParameters(dense).qualityInfluence, 1);
  for (const value of [0, .5, 1, 2, 3]) assert.equal(overlapParameters(dense, { qualityInfluence: value }).qualityInfluence, value);
  for (const qualityInfluence of [-.01, 3.01, NaN, Infinity, '1', null]) {
    assert.throws(() => overlapParameters(dense, { qualityInfluence }), /qualityInfluence/);
  }
  for (const query of [partial, { text: 'red' }]) {
    assert.deepEqual(buildOverlapQuery({ method: dense, query }), buildOverlapQuery({ method: dense, query, parameters: { qualityInfluence: 1 } }));
    const ignored = buildOverlapQuery({ method: dense, query, parameters: { qualityInfluence: 0 } });
    assert.ok(!JSON.stringify(ignored).includes('quality_'), 'Ignoring quality must neither score nor require its field.');
  }
});

test('quality influence stays native and zero desired areas ignore it even at maximum strength', () => {
  const query = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 0 }, { name: 'green', percent: 40 }] };
  const target = resolveOverlapTargets(dense, query).targets[0];
  for (const qualityInfluence of [0, .5, 1, 2, 3]) {
    const body = buildOverlapQuery({ method: dense, query, parameters: { qualityInfluence } });
    assert.ok(!JSON.stringify(body).includes('script'));
    assert.ok(!JSON.stringify(body.query.bool.should[0]).includes(target.qualityField));
  }
});

test('quality curves preserve historical defaults and share native zero/one influence fast paths', () => {
  for (const method of OVERLAP_METHODS) {
    assert.equal(overlapParameters(method).qualityCurve, 'linear');
    for (const qualityCurve of ['linear', 'power']) assert.equal(overlapParameters(method, { qualityCurve }).qualityCurve, qualityCurve);
    for (const qualityCurve of ['smooth', '', 0, false, null, undefined]) assert.throws(() => overlapParameters(method, { qualityCurve }), /qualityCurve/);
    for (const query of [partial, { text: 'red' }]) for (const qualityInfluence of [0, 1]) {
      const original = buildOverlapQuery({ method, query, parameters: { qualityInfluence } });
      assert.deepEqual(buildOverlapQuery({ method, query, parameters: { qualityInfluence, qualityCurve: 'linear' } }), original);
      assert.deepEqual(buildOverlapQuery({ method, query, parameters: { qualityInfluence, qualityCurve: 'power' } }), original);
      assert.ok(!JSON.stringify(original).includes('script'));
    }
  }
});

test('power quality runs inside OpenSearch with reusable script parameters and unchanged gates', () => {
  const sources = new Set();
  for (const method of OVERLAP_METHODS) for (const query of [partial, { text: 'red' }]) for (const qualityInfluence of [.5, 1.5, 3]) {
    const parameters = { qualityCurve: 'power', qualityInfluence, minimumQuality: .7 };
    const target = resolveOverlapTargets(method, query, { parameters }).targets[0];
    const body = buildOverlapQuery({ method, query, parameters });
    const functions = body.query.bool.should[0].function_score.functions;
    const script = functions.find(fn => fn.script_score)?.script_score.script;
    assert.ok(script, 'Power scoring must execute inside the global OpenSearch query.');
    assert.equal(script.lang, 'painless');
    assert.deepEqual(script.params, { field: target.qualityField, exponent: qualityInfluence, penalty: query.mode === 'proportions' ? .35 : 1 });
    sources.add(script.source);
    assert.deepEqual(functions.find(fn => fn.weight === 0), { filter: { range: { [target.qualityField]: { lt: Math.fround(.7) } } }, weight: 0 });
  }
  assert.equal(sources.size, 1, 'Changing a color or exponent must reuse the compiled script source.');
  const query = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 0 }, { name: 'green', percent: 40 }] };
  for (const method of OVERLAP_METHODS) {
    const body = buildOverlapQuery({ method, query, parameters: { qualityCurve: 'power', qualityInfluence: 3, minimumQuality: 1 } });
    assert.ok(!JSON.stringify(body.query.bool.should[0]).includes('quality_'));
    assert.ok(!JSON.stringify(body.query.bool.should[0]).includes('script_score'));
    const ignored = buildOverlapQuery({ method, query: partial, parameters: { qualityCurve: 'power', qualityInfluence: 3, qualityPenalty: 0 } });
    assert.ok(!JSON.stringify(ignored).includes('script_score'), 'A disabled proportions quality penalty needs no power script.');
  }
});

test('real OpenSearch power preserves weaker colors and agrees with independent fractional-power scores', { skip: process.env.COLOR_OVERLAP_INTEGRATION !== '1', timeout: 120000 }, async () => {
  const index = `color-exploration-power-quality-test-${process.pid}-${Date.now()}`;
  const target = resolveOverlapTargets(dense, { targets: [{ color: '#ff2200' }] }).targets[0];
  const documents = [
    { id: 'zero-quality', coverage: .4, quality: 0 },
    { id: 'weak', coverage: .9, quality: .6 },
    { id: 'strong', coverage: .4, quality: .9 },
    { id: 'perfect', coverage: .4, quality: 1 },
  ];
  await createIndex(index, { fields: [] });
  try {
    await bulkIndex(index, documents.map(doc => ({ id: doc.id, [target.coverageField]: Math.round(doc.coverage * 10000), [target.qualityField]: doc.quality })));
    await finishIndex(index);
    for (const method of OVERLAP_METHODS) for (const mode of ['vibe', 'proportions']) for (const qualityInfluence of [0, .5, 1, 1.5, 3]) {
      const query = { mode, targets: [{ color: '#ff2200', ...(mode === 'proportions' ? { percent: 40 } : {}) }] };
      const current = await searchIndex(index, buildOverlapQuery({ method, query, limit: documents.length, parameters: { qualityCurve: 'power', qualityInfluence } }));
      for (const doc of documents) {
        const area = mode === 'vibe' ? Math.sqrt(doc.coverage) : Math.max(0, 1 - Math.abs(doc.coverage - .4) * (doc.coverage > .4 ? 1.5 : 1));
        const base = mode === 'vibe' ? Math.fround(doc.quality) : 1 - .35 * (1 - Math.fround(doc.quality));
        const expected = area * base ** qualityInfluence;
        assert.ok(Math.abs(current.hits.find(hit => hit.id === doc.id).score - expected) < 2e-6, JSON.stringify({ method: method.id, mode, qualityInfluence, id: doc.id, expected, hits: current.hits }));
      }
      if (mode === 'vibe' && qualityInfluence === 3) {
        const linear = await searchIndex(index, buildOverlapQuery({ method, query, limit: documents.length, parameters: { qualityCurve: 'linear', qualityInfluence } }));
        assert.equal(linear.hits.find(hit => hit.id === 'weak').score, 0);
        assert.ok(current.hits.find(hit => hit.id === 'weak').score > .2);
      }
    }
  } finally { await api(index, { method: 'DELETE' }); }
});

test('minimum quality validates a fractional threshold and zero preserves native query behavior', () => {
  for (const method of OVERLAP_METHODS) {
    assert.equal(overlapParameters(method).minimumQuality, 0);
    for (const minimumQuality of [0, .5, .7, 1]) assert.equal(overlapParameters(method, { minimumQuality }).minimumQuality, minimumQuality);
    for (const minimumQuality of [-.01, 1.01, NaN, Infinity, '0.7', null]) assert.throws(() => overlapParameters(method, { minimumQuality }), /minimumQuality/);
    for (const query of [partial, { text: 'red' }]) {
      assert.deepEqual(buildOverlapQuery({ method, query }), buildOverlapQuery({ method, query, parameters: { minimumQuality: 0 } }));
      assert.equal(buildOverlapQuery({ method, query }).query.bool.should[0].function_score.functions.some(value => value.weight === 0), false);
    }
  }
});

test('minimum quality zeros only an individual positive target, including when quality influence is disabled', () => {
  const query = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 0 }, { name: 'green', percent: 40 }] };
  for (const method of OVERLAP_METHODS) {
    const targets = resolveOverlapTargets(method, query).targets;
    const body = buildOverlapQuery({ method, query, parameters: { minimumQuality: .7, qualityInfluence: 0 } });
    assert.ok(!JSON.stringify(body.query.bool.should[0]).includes(targets[0].qualityField), 'Zero-area target must remain exempt.');
    assert.deepEqual(body.query.bool.should[1].function_score.functions.find(value => value.weight === 0), {
      filter: { range: { [targets[1].qualityField]: { lt: Math.fround(.7) } } }, weight: 0,
    });
    assert.ok(body.query.bool.filter.some(value => value.exists?.field === targets[1].qualityField), 'The gate still needs the quality field.');
    for (const clause of body.query.bool.should) assert.deepEqual(clause.function_score.functions.at(-1), { weight: .5 });
    assert.ok(!JSON.stringify(body).includes('script'));
    assert.equal(body.query.bool.filter.some(value => value.range), false, 'Quality must not remove a whole wallpaper.');
  }
});

test('real OpenSearch minimum quality gates inclusive float boundaries per target without dropping documents', { skip: process.env.COLOR_OVERLAP_INTEGRATION !== '1', timeout: 120000 }, async () => {
  const index = `color-exploration-minimum-quality-test-${process.pid}-${Date.now()}`;
  const documents = [
    { id: 'equal-decimal', area: [.4, .6], quality: [.7, .8] },
    { id: 'float-below', area: [.4, .6], quality: [.69999994, .8] },
    { id: 'float-above', area: [.4, .6], quality: [.70000005, .8] },
    { id: 'all-below', area: [.4, .6], quality: [.6, .6] },
    { id: 'perfect', area: [.4, .6], quality: [1, 1] },
    { id: 'wrong-area', area: [.2, .8], quality: [.95, .9] },
    { id: 'absent', area: [0, 0], quality: [0, 0] },
  ];
  await createIndex(index, { fields: [] });
  try {
    await bulkIndex(index, documents.map(doc => {
      const fields = { id: doc.id };
      for (const method of OVERLAP_METHODS) {
        const targets = resolveOverlapTargets(method, { targets: [{ name: 'red' }, { name: 'green' }] }).targets;
        targets.forEach((target, i) => { fields[target.coverageField] = doc.area[i] * 10000; fields[target.qualityField] = doc.quality[i]; });
      }
      return fields;
    }));
    await finishIndex(index);
    for (const method of OVERLAP_METHODS) for (const mode of ['vibe', 'proportions']) for (const minimumQuality of [0, .7, 1]) for (const qualityInfluence of [0, 1, 3]) {
      const query = { mode, targets: [{ name: 'red', ...(mode === 'proportions' ? { percent: 40 } : {}) }, { name: 'green', ...(mode === 'proportions' ? { percent: 60 } : {}) }] };
      const response = await searchIndex(index, buildOverlapQuery({ method, query, limit: documents.length, parameters: { minimumQuality, qualityInfluence } }));
      assert.equal(response.hits.length, documents.length, 'Zero scores retain their wallpapers.');
      for (const doc of documents) {
        const expected = doc.area.reduce((total, coverage, i) => {
          const quality = Math.fround(doc.quality[i]);
          const requested = i ? .6 : .4;
          const areaFactor = mode === 'vibe' ? Math.sqrt(coverage) : Math.max(0, 1 - Math.abs(coverage - requested) * (coverage > requested ? 1.5 : 1));
          const qualityFactor = Math.max(0, 1 - qualityInfluence * (mode === 'vibe' ? 1 : .35) * (1 - quality));
          return total + (quality >= Math.fround(minimumQuality) ? areaFactor * qualityFactor / 2 : 0);
        }, 0);
        const actual = response.hits.find(hit => hit.id === doc.id).score;
        assert.ok(Math.abs(actual - expected) < 2e-6, JSON.stringify({ method: method.id, mode, minimumQuality, qualityInfluence, id: doc.id, actual, expected }));
      }
      if (minimumQuality === .7) assert.ok(response.hits.find(hit => hit.id === 'equal-decimal').score > response.hits.find(hit => hit.id === 'float-below').score);
    }
    for (const method of OVERLAP_METHODS) {
      const query = { mode: 'proportions', targets: [{ name: 'red', percent: 0 }, { name: 'green', percent: 40 }] };
      const response = await searchIndex(index, buildOverlapQuery({ method, query, limit: documents.length, parameters: { minimumQuality: 1, qualityInfluence: 0 } }));
      assert.equal(response.hits.find(hit => hit.id === 'absent').score, .5, 'Absence matches a zero target independently of quality, retaining the two-target denominator.');
    }
  } finally { await api(index, { method: 'DELETE' }); }
});

test('real OpenSearch quality influence changes ranking and clamps scores in both modes', { skip: process.env.COLOR_OVERLAP_INTEGRATION !== '1', timeout: 120000 }, async () => {
  const index = `color-exploration-quality-influence-test-${process.pid}-${Date.now()}`;
  const queryColor = { targets: [{ color: '#ff2200' }] };
  const target = resolveOverlapTargets(dense, queryColor).targets[0];
  const documents = [
    { id: 'large-weaker', area: .9, quality: .55 },
    { id: 'small-stronger', area: .45, quality: .95 },
    { id: 'medium-edge', area: .65, quality: .5 },
    { id: 'absent', area: 0, quality: 0 },
  ];
  await createIndex(index, { fields: [] });
  try {
    await bulkIndex(index, documents.map(({ id, area, quality }) => ({ id, [target.coverageField]: area * 10000, [target.qualityField]: quality })));
    await finishIndex(index);
    const orders = new Map();
    for (const method of OVERLAP_METHODS) for (const mode of ['vibe', 'proportions']) for (const qualityInfluence of [0, .5, 1, 2, 3]) {
      const query = { mode, targets: [{ color: '#ff2200', ...(mode === 'proportions' ? { percent: 65 } : {}) }] };
      const response = await searchIndex(index, buildOverlapQuery({ method, query, limit: documents.length, parameters: { qualityInfluence } }));
      const strength = qualityInfluence * (mode === 'vibe' ? 1 : .35);
      const expected = documents.map(doc => {
        const area = mode === 'vibe' ? Math.sqrt(doc.area) : Math.max(0, 1 - Math.abs(doc.area - .65) * (doc.area > .65 ? 1.5 : 1));
        return { id: doc.id, score: area * Math.max(0, 1 - strength * (1 - doc.quality)) };
      }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      assert.deepEqual(response.hits.map(hit => hit.id), expected.map(hit => hit.id), `${method.id} ${mode} ${qualityInfluence}`);
      for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(response.hits[i].score - expected[i].score) < 2e-6, `${mode} ${qualityInfluence}: ${JSON.stringify(response.hits[i])}`);
      orders.set(`${mode}:${qualityInfluence}`, response.hits.map(hit => hit.id));
    }
    assert.notDeepEqual(orders.get('vibe:0'), orders.get('vibe:3'));
    assert.notDeepEqual(orders.get('proportions:0'), orders.get('proportions:3'));
  } finally {
    await api(index, { method: 'DELETE' });
  }
});
