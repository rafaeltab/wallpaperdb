import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverlapInspectionQuery, inspectOverlap } from './overlap-diagnostics.mjs';
import { OVERLAP_METHODS, buildOverlapQuery, resolveOverlapTargets } from './methods-overlap.mjs';
import { OVERLAP_INDEX, overlapMapping } from './overlap-index.mjs';
import { OVERLAP_REGIONS, regionFields } from './overlap-regions.mjs';
import { OVERLAP_BUCKET_COUNTS, overlapRegionsForCount, overlapIndexForCount } from './overlap-banks.mjs';
import { executeSearch } from './registry.mjs';
import { buildNativeRefinedQuery } from './methods-native-refined.mjs';
import { INDEX, api, bulkIndex, finishIndex, searchIndex } from './service.mjs';

const red = { targets: [{ color: '#ff2200' }] };
const proportion = targets => ({ mode: 'proportions', targets });

test('count-specific diagnostics read only selected bank fields and carry original sparse region IDs', () => {
  for (const bucketCount of OVERLAP_BUCKET_COUNTS) {
    const regions = overlapRegionsForCount(bucketCount), parameters = { bucketCount, qualityInfluence: 2, minimumQuality: .7 };
    const query = { targets: [{ color: regions.at(-1).hex }] };
    const body = buildOverlapInspectionQuery({ id: 'x', query, parameters });
    const script = body.script_fields.overlap_diagnostics.script;
    assert.deepEqual(script.params.regionIndexes, regions.map(region => region.index));
    assert.deepEqual(script.params.coverageFields, regions.map(region => regionFields(region.index).coverage));
    assert.deepEqual(script.params.qualityFields, regions.map(region => regionFields(region.index).quality));
    assert.equal(script.params.targets[0].regionIndex, regions.at(-1).index);
    assert.equal(script.params.bucketCount, bucketCount);
    assert.match(script.source, /params\.regionIndexes\.get\(i\)/);
    assert.deepEqual(body.query, buildOverlapQuery({ method: 'overlap-quality-dense', query, parameters, filter: { ids: { values: ['x'] } }, limit: 1 }).query);
  }
});

test('inspection preserves native ranking and confines diagnostic scripts to one wallpaper', () => {
  for (const method of OVERLAP_METHODS) for (const query of [red, proportion([{ name: 'green', percent: 40 }])]) {
    const inspected = buildOverlapInspectionQuery({ method, id: 'wallpaper-042', query });
    const original = buildOverlapQuery({ method, query, limit: 1, filter: { ids: { values: ['wallpaper-042'] } } });
    assert.deepEqual(inspected.query, original.query);
    assert.deepEqual(inspected.sort, original.sort);
    assert.equal(inspected.size, 1);
    assert.ok(!JSON.stringify(inspected.query).includes('script'));
    const script = inspected.script_fields.overlap_diagnostics.script;
    assert.equal(script.params.coverageFields.length, 1024);
    assert.equal(script.params.qualityFields.length, 1024);
    assert.equal(script.params.targets.length, 1);
    assert.equal(inspected._source, false);
  }
});

test('inspection retains subject constraints and rejects invalid queries before service access', () => {
  const body = buildOverlapInspectionQuery({ method: 'overlap-quality-dense', id: 'x', query: { ...red, subject: 'city' } });
  assert.deepEqual(body.query.bool.filter[0].bool.filter, [{ ids: { values: ['x'] } }, { term: { tags: 'city' } }]);
  assert.throws(() => buildOverlapInspectionQuery({ id: '', query: red }), /wallpaper ID/);
  assert.throws(() => buildOverlapInspectionQuery({ id: 'x', query: { targets: [{ color: '#ff2200', distance: .2 }] } }), /0.12/);
});

test('inspection passes explicit quality influence through to the native query and diagnostic ledger', () => {
  for (const qualityInfluence of [0, .5, 1, 2, 3]) {
    const parameters = { qualityInfluence };
    const body = buildOverlapInspectionQuery({ id: 'x', query: red, parameters });
    assert.equal(body.script_fields.overlap_diagnostics.script.params.qualityInfluence, qualityInfluence);
    assert.deepEqual(body.query, buildOverlapQuery({ method: 'overlap-quality-dense', query: red, parameters, filter: { ids: { values: ['x'] } }, limit: 1 }).query);
  }
  assert.throws(() => buildOverlapInspectionQuery({ id: 'x', query: red, parameters: { qualityInfluence: 4 } }), /qualityInfluence/);
});

test('inspection preserves requested minimum quality and supplies the same float32 threshold as native filtering', () => {
  const body = buildOverlapInspectionQuery({ id: 'x', query: red, parameters: { minimumQuality: .7, qualityInfluence: 0 } });
  assert.equal(body.script_fields.overlap_diagnostics.script.params.minimumQuality, .7);
  assert.equal(body.script_fields.overlap_diagnostics.script.params.effectiveMinimumQuality, Math.fround(.7));
  assert.throws(() => buildOverlapInspectionQuery({ id: 'x', query: red, parameters: { minimumQuality: 1.01 } }), /minimumQuality/);
});

test('overlap inspection carries the selected quality curve into its ledger and preserves the ranking query', () => {
  for (const method of OVERLAP_METHODS) for (const qualityCurve of ['linear', 'power']) for (const mode of ['vibe', 'proportions']) {
    const query = { mode, targets: [{ color: '#ff2200', ...(mode === 'proportions' ? { percent: 40 } : {}) }] };
    const parameters = { bucketCount: 16, qualityCurve, qualityInfluence: 3 };
    const body = buildOverlapInspectionQuery({ method, id: 'x', query, parameters });
    assert.equal(body.script_fields.overlap_diagnostics.script.params.qualityCurve, qualityCurve);
    assert.deepEqual(body.query, buildOverlapQuery({ method, query, parameters, limit: 1, filter: { ids: { values: ['x'] } } }).query);
  }
  assert.equal(buildOverlapInspectionQuery({ id: 'x', query: red }).script_fields.overlap_diagnostics.script.params.qualityCurve, 'linear');
});

const integration = process.env.COLOR_OVERLAP_INTEGRATION === '1';
test('real OpenSearch power overlap scores and ledgers agree at endpoints, fractional exponents, and inclusive quality gates', { skip: !integration, timeout: 120000 }, async () => {
  const index = `color-exploration-power-overlap-test-${process.pid}-${Date.now()}`;
  const parameters = { bucketCount: 16, qualityCurve: 'power', qualityInfluence: 3 };
  const observations = [
    { id: 'zero', quality: 0, coverage: 4000 },
    { id: 'moderate', quality: .6, coverage: 4000 },
    { id: 'perfect', quality: 1, coverage: 4000 },
    { id: 'equal', quality: .7, coverage: 4000 },
    { id: 'below', quality: .69999994, coverage: 4000 },
    { id: 'absent', quality: 0, coverage: 0 },
  ];
  const baseline = Object.fromEntries(overlapRegionsForCount(16).flatMap(region => Object.values(regionFields(region.index)).map(field => [field, 0])));
  await api(index, { method: 'PUT', body: overlapMapping() });
  try {
    await bulkIndex(index, observations.map(observation => {
      const document = { id: observation.id, overlap_pixel_total: 16384, cov_dark: 0, quality_dark: 0, ...baseline };
      for (const method of OVERLAP_METHODS) {
        const [target] = resolveOverlapTargets(method, { text: 'red' }, { parameters }).targets;
        document[target.coverageField] = observation.coverage;
        document[target.qualityField] = observation.quality;
      }
      return document;
    }));
    await finishIndex(index);
    for (const method of OVERLAP_METHODS) for (const mode of ['vibe', 'proportions']) for (const qualityInfluence of [0, .5, 3]) {
      const query = { mode, targets: [{ name: 'red', ...(mode === 'proportions' ? { percent: 40 } : {}) }] };
      const currentParameters = { ...parameters, qualityInfluence };
      const search = await searchIndex(index, buildOverlapQuery({ method, query, parameters: currentParameters, limit: observations.length }));
      assert.equal(search.hits.length, observations.length);
      for (const observation of observations.slice(0, 3)) {
        const result = await inspectOverlap({ method, index, id: observation.id, query, parameters: currentParameters });
        const [term] = result.score.terms;
        const expectedBase = mode === 'vibe' ? Math.fround(observation.quality) : 1 - .35 * (1 - Math.fround(observation.quality));
        const expectedFactor = expectedBase ** qualityInfluence;
        const expectedArea = mode === 'vibe' ? Math.sqrt(.4) : 1;
        assert.equal(result.score.qualityCurve, 'power');
        assert.equal(term.qualityCurve, 'power');
        assert.equal(term.qualityStrength, null);
        assert.equal(term.qualityExponent, qualityInfluence);
        assert.ok(Math.abs(term.qualityBase - expectedBase) < 1e-12);
        assert.ok(Math.abs(term.qualityFactor - expectedFactor) < 1e-12);
        assert.ok(Math.abs(result.score.actual - expectedArea * expectedFactor) < 2e-6, JSON.stringify(result.score));
        assert.ok(Math.abs(result.score.difference) < 2e-6);
        assert.equal(result.score.actual, search.hits.find(hit => hit.id === observation.id).score);
        assert.match(result.score.formula, /\^/);
        assert.doesNotMatch(result.score.description, /native score/);
        assert.doesNotMatch(result.evidence.computation, /Native OpenSearch ranking/);
        if (observation.id === 'moderate' && qualityInfluence === 3) assert.ok(result.score.actual > 0, 'Quality 0.6 must remain positive at influence 3.');
      }
      for (const id of ['equal', 'below']) {
        const gated = await inspectOverlap({ method, index, id, query, parameters: { ...currentParameters, minimumQuality: .7 } });
        assert.equal(gated.score.terms[0].passesMinimumQuality, id === 'equal');
        assert.equal(gated.score.terms[0].effectiveMinimumQuality, Math.fround(.7));
        assert.ok(Math.abs(gated.score.difference) < 2e-6);
        if (id === 'below') assert.equal(gated.score.actual, 0);
      }
    }
    for (const method of OVERLAP_METHODS) {
      const result = await inspectOverlap({ method, index, id: 'absent', query: proportion([{ name: 'red', percent: 0 }, { name: 'dark', percent: 40 }]), parameters: { ...parameters, minimumQuality: 1 } });
      assert.equal(result.score.actual, .5);
      assert.equal(result.score.terms[0].qualityBase, 1);
      assert.equal(result.score.terms[0].qualityFactor, 1);
      assert.equal(result.score.terms[0].qualityThresholdApplies, false);
      assert.equal(result.score.terms[0].qualityGateFactor, 1);
      assert.equal(result.score.terms[0].scoreContribution, .5);
      assert.equal(result.score.terms[1].qualityGateFactor, 0);
    }
  } finally { await api(index, { method: 'DELETE' }); }
});
test('real OpenSearch all four bucket counts return matching service rankings and selected-bank ledgers', { skip: !integration, timeout: 120000 }, async () => {
  for (const bucketCount of OVERLAP_BUCKET_COUNTS) for (const method of OVERLAP_METHODS) {
    const bank = overlapRegionsForCount(bucketCount), parameters = { bucketCount, qualityInfluence: 2, minimumQuality: .6 };
    const queries = [{ targets: [{ color: bank.at(-1).hex }] }, proportion([{ color: '#ff2200', percent: 40 }, { name: 'dark', percent: 60 }])];
    for (const query of queries) {
      const response = await executeSearch({ method, query, parameters, limit: 3 });
      assert.equal(response.hits.length, 3);
      const result = await inspectOverlap({ method, query, parameters, id: response.hits[0].id });
      assert.equal(result.evidence.index, overlapIndexForCount(bucketCount));
      assert.equal(result.parameters.bucketCount, bucketCount);
      assert.equal(result.regions.length, bucketCount);
      assert.equal(result.definition.anchorCount, bucketCount);
      assert.deepEqual(result.regions.map(region => region.index), bank.map(region => region.index));
      assert.equal(result.score.actual, response.hits[0].score);
      assert.ok(Math.abs(result.score.difference) < 2e-6, JSON.stringify(result.score));
      for (const term of result.score.terms.filter(term => term.kind === 'region')) {
        const region = result.regions.find(region => region.index === term.regionIndex);
        assert.ok(region.selectedBy.includes(term.targetIndex));
        assert.equal(region.coverage, term.coverage);
        assert.equal(region.conditionalQuality, term.conditionalQuality);
      }
    }
  }
});
test('real OpenSearch quality gate ledger agrees at inclusive decimal boundaries and exempts zero targets', { skip: !integration, timeout: 120000 }, async () => {
  const index = `color-exploration-minimum-quality-ledger-test-${process.pid}-${Date.now()}`;
  const observations = [
    { id: 'equal', quality: [.7, .8], coverage: [4000, 6000] },
    { id: 'below', quality: [.69999994, .8], coverage: [4000, 6000] },
    { id: 'all-below', quality: [.6, .6], coverage: [4000, 6000] },
    { id: 'absent', quality: [0, 0], coverage: [0, 0] },
  ];
  const zeroRegionFields = Object.fromEntries(OVERLAP_REGIONS.flatMap(region => Object.values(regionFields(region.index)).map(field => [field, 0])));
  await api(index, { method: 'PUT', body: overlapMapping() });
  try {
    await bulkIndex(index, observations.map(observation => {
      const document = { id: observation.id, overlap_pixel_total: 16384, ...zeroRegionFields };
      for (const method of OVERLAP_METHODS) resolveOverlapTargets(method, { targets: [{ name: 'red' }, { name: 'green' }] }).targets.forEach((target, i) => {
        document[target.coverageField] = observation.coverage[i]; document[target.qualityField] = observation.quality[i];
      });
      return document;
    }));
    await finishIndex(index);
    for (const method of OVERLAP_METHODS) for (const mode of ['vibe', 'proportions']) for (const qualityInfluence of [0, 1, 3]) for (const observation of observations) {
      const query = { mode, targets: [{ name: 'red', ...(mode === 'proportions' ? { percent: 40 } : {}) }, { name: 'green', ...(mode === 'proportions' ? { percent: 60 } : {}) }] };
      const result = await inspectOverlap({ method, id: observation.id, index, query, parameters: { minimumQuality: .7, qualityInfluence } });
      assert.equal(result.parameters.minimumQuality, .7);
      assert.match(result.score.formula, /qualityGate/);
      assert.ok(Math.abs(result.score.difference) < 2e-6, JSON.stringify(result.score));
      result.score.terms.forEach((term, i) => {
        assert.equal(term.minimumQuality, .7);
        assert.equal(term.effectiveMinimumQuality, Math.fround(.7));
        assert.equal(term.qualityThresholdApplies, true);
        assert.equal(term.passesMinimumQuality, Math.fround(observation.quality[i]) >= Math.fround(.7));
        assert.equal(term.qualityGateFactor, term.passesMinimumQuality ? 1 : 0);
        assert.ok(Math.abs(term.scoreContribution - term.areaFactor * term.qualityFactor * term.qualityGateFactor / 2) < 1e-12);
      });
      if (observation.id === 'all-below' || observation.id === 'absent') assert.equal(result.score.actual, 0);
    }
    for (const method of OVERLAP_METHODS) {
      const result = await inspectOverlap({ method, id: 'absent', index, query: proportion([{ name: 'red', percent: 0 }, { name: 'green', percent: 40 }]), parameters: { minimumQuality: .7, qualityInfluence: 0 } });
      assert.equal(result.score.actual, .5);
      const [absence, positive] = result.score.terms;
      assert.equal(absence.qualityThresholdApplies, false);
      assert.equal(absence.passesMinimumQuality, true);
      assert.equal(absence.qualityGateFactor, 1);
      assert.equal(positive.passesMinimumQuality, false);
      assert.equal(positive.qualityGateFactor, 0);
    }
  } finally { await api(index, { method: 'DELETE' }); }
});
test('real OpenSearch native scores match one-document coverage and quality explanations', { skip: !integration, timeout: 120000 }, async () => {
  const queries = [
    red,
    { text: 'red' },
    { text: 'dark' },
    proportion([{ color: '#ff2200', percent: 40 }]),
    proportion([{ name: 'grayscale', percent: 80 }, { name: 'red', percent: 20 }]),
    proportion([{ name: 'grayscale', percent: 80 }, { name: 'red', percent: 10 }]),
    proportion([{ name: 'red', percent: 0 }, { name: 'green', percent: 40 }]),
    { mode: 'proportions', overlap: 'marginal', targets: [{ color: '#ff2200', percent: 70 }, { color: '#f02000', percent: 70 }] },
  ];
  for (const method of OVERLAP_METHODS) for (const query of queries) {
    const reference = await searchIndex(OVERLAP_INDEX, buildOverlapQuery({ method, query, limit: 3 }));
    assert.equal(reference.hits.length, 3);
    for (const hit of [reference.hits[0], reference.hits[2]]) {
      const result = await inspectOverlap({ id: hit.id, method, query });
      assert.equal(result.score.actual, hit.score);
      assert.ok(Math.abs(result.score.difference) < 2e-6, JSON.stringify(result.score));
      assert.equal(result.regions.length, 1024);
      assert.equal(new Set(result.regions.map(region => region.index)).size, 1024);
      assert.equal(result.totals.pixelCount, 16384);
      const source = (await api(`${OVERLAP_INDEX}/_doc/${encodeURIComponent(hit.id)}`)).body._source;
      const targets = resolveOverlapTargets(method, query).targets;
      let total = 0;
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i], term = result.score.terms[i];
        assert.equal(term.coverage, source[target.coverageField] / 10000);
        assert.ok(Math.abs(term.conditionalQuality - source[target.qualityField]) < 1e-7);
        assert.ok(Math.abs(term.qualityMass - term.coverage * term.conditionalQuality) < 1e-12);
        assert.ok(Math.abs(term.scoreContribution - term.areaFactor * term.qualityFactor / targets.length) < 1e-12);
        if (target.regionIndex !== null) {
          const region = result.regions[target.regionIndex];
          assert.equal(region.coverage, term.coverage);
          assert.equal(region.conditionalQuality, term.conditionalQuality);
          assert.ok(region.selectedBy.includes(i));
        }
        total += term.scoreContribution;
      }
      assert.ok(Math.abs(total - result.score.reconstructed) < 1e-12);
      for (const region of result.regions) {
        assert.equal(region.hex, OVERLAP_REGIONS[region.index].hex);
        assert.ok(region.coverage >= 0 && region.coverage <= 1);
        assert.ok(region.conditionalQuality === 0 || region.conditionalQuality >= .5);
      }
      assert.equal(Object.hasOwn(result.totals, 'unionArea'), false, 'Overlapping marginals cannot identify union area.');
    }
  }
  await assert.rejects(inspectOverlap({ id: 'missing-overlap-wallpaper', query: red }), /not found|not eligible/);
});

test('hybrid keeps the previous named coverage-quality ranking exactly on the full corpus', { skip: !integration, timeout: 120000 }, async () => {
  for (const query of [
    { text: 'red' }, { text: 'dark' },
    proportion([{ name: 'green', percent: 40 }]),
    proportion([{ name: 'grayscale', percent: 80 }, { name: 'red', percent: 20 }]),
    proportion([{ name: 'red', percent: 50 }, { name: 'green', percent: 50 }]),
  ]) {
    const reference = await searchIndex(INDEX, buildNativeRefinedQuery({ method: 'native-quality-asymmetric', query, limit: 545 }));
    const current = await searchIndex(OVERLAP_INDEX, buildOverlapQuery({ method: 'overlap-quality-hybrid', query, limit: 545 }));
    assert.equal(current.hits.length, 545);
    assert.deepEqual(current.hits, reference.hits);
  }
});

test('real OpenSearch diagnostic ledger follows quality influence, including zero targets and clamping', { skip: !integration, timeout: 120000 }, async () => {
  for (const method of OVERLAP_METHODS) for (const query of [
    red,
    proportion([{ color: '#ff2200', percent: 40 }]),
    proportion([{ color: '#ff2200', percent: 0 }, { name: 'green', percent: 40 }]),
  ]) for (const qualityInfluence of [0, .5, 1, 2, 3]) {
    const parameters = { qualityInfluence };
    const response = await searchIndex(OVERLAP_INDEX, buildOverlapQuery({ method, query, parameters, limit: 2 }));
    const result = await inspectOverlap({ id: response.hits[1].id, method, query, parameters });
    assert.ok(Math.abs(result.score.difference) < 2e-6, JSON.stringify(result.score));
    assert.equal(result.parameters.qualityInfluence, qualityInfluence);
    assert.match(result.score.formula, /max\(0/);
    for (const term of result.score.terms) {
      const strength = qualityInfluence * (result.compiled.mode === 'vibe' ? 1 : .35);
      const factor = result.compiled.mode === 'proportions' && term.amount === 0 ? 1 : Math.max(0, 1 - strength * (1 - term.conditionalQuality));
      assert.ok(Math.abs(term.qualityFactor - factor) < 1e-12, JSON.stringify(term));
      assert.equal(term.qualityInfluence, qualityInfluence);
      assert.equal(term.qualityStrength, result.compiled.mode === 'proportions' && term.amount === 0 ? 0 : strength);
    }
  }
});
