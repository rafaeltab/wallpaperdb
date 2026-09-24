import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCutoffInspectionQuery, inspectCutoff } from './cutoff-diagnostics.mjs';
import { CUTOFF_METHODS, buildCutoffQuery, resolveCutoffTargets } from './methods-cutoff.mjs';
import { CUTOFF_LEVELS, cutoffIndexForCount, cutoffFields } from './cutoff-definition.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';
import { executeSearch } from './registry.mjs';
import { api, bulkIndex, finishIndex, searchIndex } from './service.mjs';

const integration = process.env.COLOR_CUTOFF_INTEGRATION === '1';
const query = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 40 }, { name: 'dark', percent: 60 }] };

test('cutoff inspection confines its ledger to one document and exposes individual consensus components', () => {
  for (const method of CUTOFF_METHODS) for (const bucketCount of [16, 64, 256, 1024]) {
    const parameters = { bucketCount, minimumQuality: .7, qualityInfluence: 2, pixelCutoff: .5 };
    const body = buildCutoffInspectionQuery({ method, id: 'x', query, parameters });
    assert.deepEqual(body.query, buildCutoffQuery({ method, query, parameters, limit: 1, filter: { ids: { values: ['x'] } } }).query);
    assert.equal(body.size, 1);
    assert.ok(!JSON.stringify(body.query).includes('script'));
    const params = body.script_fields.cutoff_diagnostics.script.params;
    assert.deepEqual(params.regions.map(region => region.index), overlapRegionsForCount(bucketCount).map(region => region.index));
    assert.equal(params.effectiveMinimumQuality, Math.fround(.7));
    assert.equal(params.targets[0].components.length, method.profile === 'all-levels' ? 5 : method.profile === 'consensus' ? 3 : 1);
    assert.equal(params.targets[1].components.length, 1);
    for (const region of params.regions) for (const component of region.components) {
      assert.equal(component.physicalCoverageField, cutoffFields(region.index, 'hard', component.pixelCutoff).coverage);
    }
  }
});

test('cutoff inspection carries the selected quality curve into every profile ledger and preserves its ranking query', () => {
  for (const method of CUTOFF_METHODS) for (const qualityCurve of ['linear', 'power']) {
    const parameters = { bucketCount: 16, qualityCurve, qualityInfluence: 3 };
    const body = buildCutoffInspectionQuery({ method, id: 'x', query, parameters });
    assert.equal(body.script_fields.cutoff_diagnostics.script.params.qualityCurve, qualityCurve);
    assert.deepEqual(body.query, buildCutoffQuery({ method, query, parameters, limit: 1, filter: { ids: { values: ['x'] } } }).query);
  }
  assert.equal(buildCutoffInspectionQuery({ id: 'x', query }).script_fields.cutoff_diagnostics.script.params.qualityCurve, 'linear');
});

test('all-levels ledgers carry every actual query coefficient to all inspected regions', () => {
  for (const cutoffBlendExponent of [0, 3, 6]) {
    const parameters = { bucketCount: 16, cutoffBlendExponent, qualityCurve: 'power', qualityInfluence: 3 };
    const body = buildCutoffInspectionQuery({ method: 'cutoff-all-levels', id: 'x', query, parameters });
    const params = body.script_fields.cutoff_diagnostics.script.params;
    assert.equal(params.pixelCutoff, 0);
    assert.equal(params.cutoffBlendExponent, cutoffBlendExponent);
    const components = params.targets[0].components;
    assert.deepEqual(components.map(component => component.pixelCutoff), [0, .25, .5, .75, .9]);
    for (const region of params.regions) assert.deepEqual(region.components.map(component => component.componentWeight), components.map(component => component.componentWeight));
    components.forEach((component, i) => assert.equal(body.query.bool.should[i].function_score.functions.at(-1).weight, component.componentWeight / 2));
    assert.equal(params.targets[1].components[0].componentWeight, 1);
  }
});

test('real OpenSearch all-levels distribution changes global winners and gates components without redistributing weights', { skip: !integration, timeout: 120000 }, async () => {
  const index = `color-exploration-all-cutoffs-test-${process.pid}-${Date.now()}`;
  const method = 'cutoff-all-levels', request = { targets: [{ color: '#ff2200' }] };
  const parameters = { bucketCount: 16, qualityCurve: 'power', qualityInfluence: 0 };
  const [target] = resolveCutoffTargets(method, request, { parameters }).targets;
  const baseline = { overlap_pixel_total: 16384 };
  for (const region of overlapRegionsForCount(16)) for (const { cutoff } of CUTOFF_LEVELS) {
    const fields = cutoffFields(region.index, 'hard', cutoff);
    baseline[fields.coverage] = 0;
    baseline[fields.quality] = 0;
  }
  const properties = Object.fromEntries(Object.keys(baseline).map(field => [field, { type: field.startsWith('quality_') ? 'float' : 'integer' }]));
  const broad = { id: 'broad', ...baseline }, precise = { id: 'precise', ...baseline };
  target.components.forEach((component, i) => {
    broad[component.coverageField] = i < 3 ? 10000 : 0;
    broad[component.qualityField] = i < 3 ? .65 : 0;
    precise[component.coverageField] = 2000;
    precise[component.qualityField] = .95;
  });
  await api(index, { method: 'PUT', body: { settings: { number_of_shards: 1, number_of_replicas: 0 }, mappings: { properties: { id: { type: 'keyword' }, ...properties } } } });
  try {
    await bulkIndex(index, [broad, precise]);
    await finishIndex(index);
    for (const cutoffBlendExponent of [0, 3, 6]) {
      const selected = { ...parameters, cutoffBlendExponent };
      const result = await searchIndex(index, buildCutoffQuery({ method, query: request, parameters: selected, limit: 1 }));
      assert.equal(result.hits[0].id, cutoffBlendExponent === 0 ? 'broad' : 'precise');
      for (const id of ['broad', 'precise']) {
        const ledger = await inspectCutoff({ method, id, index, query: request, parameters: selected });
        assert.equal(ledger.parameters.cutoffBlendExponent, cutoffBlendExponent);
        assert.equal(ledger.definition.cutoffBlendExponent, cutoffBlendExponent);
        assert.equal(ledger.score.terms[0].components.length, 5);
        assert.ok(ledger.regions.every(region => region.components.length === 5));
        assert.ok(Math.abs(ledger.score.difference) < 2e-6);
        assert.equal(ledger.score.terms[0].areaFactor, null);
        assert.ok(ledger.score.terms[0].components.every(component => component.componentWeight > 0));
        if (id === 'precise') assert.ok(Math.abs(ledger.score.actual - Math.sqrt(.2)) < 2e-6);
        if (id === 'broad' && cutoffBlendExponent === 0) assert.ok(Math.abs(ledger.score.actual - .6) < 2e-6);
      }
    }
    const gated = await inspectCutoff({ method, id: 'broad', index, query: request, parameters: { ...parameters, minimumQuality: .7, cutoffBlendExponent: 6 } });
    assert.equal(gated.score.actual, 0);
    assert.ok(gated.score.terms[0].components.every(component => !component.passesMinimumQuality && component.componentWeight > 0));
    const partial = { ...broad, id: 'partial' };
    // A mixture with progressively stricter admitted pixels, including a zero-quality gate failure.
    target.components.forEach((component, i) => {
      partial[component.coverageField] = [10000, 8000, 5000, 3000, 1000][i];
      partial[component.qualityField] = [.6, .7, .8, .9, .95][i];
    });
    await bulkIndex(index, [partial]);
    await finishIndex(index);
    for (const qualityCurve of ['linear', 'power']) for (const cutoffBlendExponent of [0, 6]) for (const mode of ['vibe', 'proportions']) {
      const currentQuery = { mode, targets: [{ color: '#ff2200', ...(mode === 'proportions' ? { percent: 40 } : {}) }] };
      const selected = { ...parameters, qualityCurve, qualityInfluence: 3, minimumQuality: .7, cutoffBlendExponent };
      const ledger = await inspectCutoff({ method, id: 'partial', index, query: currentQuery, parameters: selected });
      const components = ledger.score.terms[0].components;
      assert.deepEqual(components.map(component => component.passesMinimumQuality), [false, true, true, true, true]);
      let expected = 0;
      components.forEach((component, i) => {
        const coverage = [1, .8, .5, .3, .1][i], q = Math.fround([.6, .7, .8, .9, .95][i]);
        const area = mode === 'vibe' ? Math.sqrt(coverage) : Math.max(0, 1 - Math.abs(coverage - .4) * (coverage > .4 ? 1.5 : 1));
        const strength = mode === 'vibe' ? 3 : .35 * 3;
        const factor = qualityCurve === 'linear' ? Math.max(0, 1 - strength * (1 - q)) : (mode === 'vibe' ? q : 1 - .35 * (1 - q)) ** 3;
        const contribution = i === 0 ? 0 : component.componentWeight * area * factor;
        assert.ok(Math.abs(component.scoreContribution - contribution) < 1e-12);
        expected += contribution;
      });
      assert.ok(Math.abs(ledger.score.actual - expected) < 2e-6);
      assert.ok(Math.abs(ledger.score.difference) < 2e-6);
    }
  } finally { await api(index, { method: 'DELETE' }); }
});

test('real OpenSearch power cutoff ledgers retain positive moderate quality, endpoints, and independently weighted consensus', { skip: !integration, timeout: 120000 }, async () => {
  const index = `color-exploration-power-cutoff-test-${process.pid}-${Date.now()}`;
  const parameters = { bucketCount: 16, pixelCutoff: .5, qualityCurve: 'power', qualityInfluence: 3 };
  const [target] = resolveCutoffTargets('cutoff-consensus', query, { parameters }).targets;
  const baseline = { overlap_pixel_total: 16384, cov_dark: 6000, quality_dark: .8 };
  for (const region of overlapRegionsForCount(16)) for (const { cutoff } of CUTOFF_LEVELS) for (const kernel of ['hard', 'feather', 'core-halo']) {
    const fields = cutoffFields(region.index, kernel, cutoff);
    baseline[fields.coverage] = 0;
    baseline[fields.quality] = 0;
  }
  const observations = [
    { id: 'zero', quality: 0 }, { id: 'moderate', quality: .6 }, { id: 'perfect', quality: 1 },
    { id: 'equal', quality: .7 }, { id: 'below', quality: .69999994 }, { id: 'absent', quality: 0 },
  ];
  const properties = Object.fromEntries(Object.keys(baseline).map(field => [field, { type: field.startsWith('quality_') ? 'float' : 'integer' }]));
  await api(index, { method: 'PUT', body: { settings: { number_of_shards: 1, number_of_replicas: 0, 'mapping.total_fields.limit': 2000 }, mappings: { properties: { id: { type: 'keyword' }, ...properties } } } });
  try {
    const documents = observations.map(observation => {
      const document = { id: observation.id, ...baseline };
      for (const { cutoff } of CUTOFF_LEVELS) for (const kernel of ['hard', 'feather', 'core-halo']) {
        const fields = cutoffFields(target.regionIndex, kernel, cutoff);
        document[fields.coverage] = observation.id === 'absent' ? 0 : 4000;
        document[fields.quality] = observation.quality;
      }
      return document;
    });
    const mixed = { id: 'mixed', ...baseline };
    target.components.forEach((component, i) => {
      mixed[component.coverageField] = [4000, 3000, 2000][i];
      mixed[component.qualityField] = [.6, .8, 1][i];
    });
    await bulkIndex(index, [...documents, mixed]);
    await finishIndex(index);
    for (const method of CUTOFF_METHODS) for (const mode of ['vibe', 'proportions']) for (const qualityInfluence of [0, .5, 3]) {
      const request = { mode, targets: [{ color: '#ff2200', ...(mode === 'proportions' ? { percent: 40 } : {}) }] };
      const currentParameters = { ...parameters, qualityInfluence };
      const search = await searchIndex(index, buildCutoffQuery({ method, query: request, parameters: currentParameters, limit: 7 }));
      assert.equal(search.hits.length, 7);
      for (const observation of observations.slice(0, 3)) {
        const ledger = await inspectCutoff({ method, index, id: observation.id, query: request, parameters: currentParameters });
        const [term] = ledger.score.terms;
        const expectedBase = mode === 'vibe' ? Math.fround(observation.quality) : 1 - .35 * (1 - Math.fround(observation.quality));
        const expectedFactor = expectedBase ** qualityInfluence;
        const expectedArea = mode === 'vibe' ? Math.sqrt(.4) : 1;
        assert.equal(ledger.score.qualityCurve, 'power');
        assert.equal(term.qualityCurve, 'power');
        assert.equal(term.qualityStrength, null);
        assert.ok(Math.abs(ledger.score.actual - expectedArea * expectedFactor) < 2e-6, JSON.stringify(ledger.score));
        assert.ok(Math.abs(ledger.score.difference) < 2e-6);
        assert.equal(ledger.score.actual, search.hits.find(hit => hit.id === observation.id).score);
        assert.doesNotMatch(ledger.score.description, /native ranking/);
        assert.doesNotMatch(ledger.evidence.computation, /Native OpenSearch ranking/);
        for (const component of term.components) {
          assert.equal(component.qualityCurve, 'power');
          assert.equal(component.qualityStrength, null);
          assert.equal(component.qualityExponent, qualityInfluence);
          assert.ok(Math.abs(component.qualityBase - expectedBase) < 1e-12);
          assert.ok(Math.abs(component.qualityFactor - expectedFactor) < 1e-12);
          assert.ok(Math.abs(component.scoreContribution - expectedArea * expectedFactor * component.componentWeight) < 1e-12);
        }
        if (term.components.length > 1) {
          assert.equal(term.qualityFactor, null);
          assert.equal(term.qualityBase, null);
          assert.equal(term.qualityExponent, null);
        }
        if (observation.id === 'moderate' && qualityInfluence === 3) assert.ok(ledger.score.actual > 0, 'Quality 0.6 must remain positive at influence 3.');
      }
      for (const id of ['equal', 'below']) {
        const ledger = await inspectCutoff({ method, index, id, query: request, parameters: { ...currentParameters, minimumQuality: .7 } });
        assert.ok(ledger.score.terms[0].components.every(component => component.passesMinimumQuality === (id === 'equal')));
        assert.ok(Math.abs(ledger.score.difference) < 2e-6);
        if (id === 'below') assert.equal(ledger.score.actual, 0);
      }
    }
    for (const mode of ['vibe', 'proportions']) {
      const request = mode === 'proportions' ? query : { targets: [{ color: '#ff2200' }, { name: 'dark' }] };
      const ledger = await inspectCutoff({ method: 'cutoff-consensus', index, id: 'mixed', query: request, parameters });
      const [region, named] = ledger.score.terms;
      let expected = 0;
      const coverages = [.4, .3, .2], qualities = [.6, .8, 1], weights = [.2, .3, .5];
      region.components.forEach((component, i) => {
        const q = Math.fround(qualities[i]);
        const area = mode === 'vibe' ? Math.sqrt(coverages[i]) : 1 - Math.abs(coverages[i] - .4);
        const factor = (mode === 'vibe' ? q : 1 - .35 * (1 - q)) ** 3;
        const contribution = weights[i] / 2 * area * factor;
        assert.equal(component.componentWeight, weights[i]);
        assert.ok(Math.abs(component.scoreContribution - contribution) < 1e-12);
        expected += contribution;
      });
      const namedQ = Math.fround(.8);
      expected += .5 * (mode === 'vibe' ? Math.sqrt(.6) * namedQ ** 3 : (1 - .35 * (1 - namedQ)) ** 3);
      assert.equal(named.components.length, 1, 'Named features are scored once rather than duplicated for every consensus cutoff.');
      assert.equal(named.components[0].weight, .5);
      assert.ok(Math.abs(ledger.score.actual - expected) < 2e-6);
      assert.ok(Math.abs(ledger.score.difference) < 2e-6);
      assert.equal(region.qualityFactor, null, 'Averaged quality is a display summary, never the scored value.');
    }
    for (const method of CUTOFF_METHODS) {
      const zeroQuery = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 0 }, { name: 'dark', percent: 60 }] };
      const ledger = await inspectCutoff({ method, index, id: 'absent', query: zeroQuery, parameters: { ...parameters, minimumQuality: 1 } });
      assert.equal(ledger.score.actual, .5);
      for (const component of ledger.score.terms[0].components) {
        assert.equal(component.qualityBase, 1);
        assert.equal(component.qualityFactor, 1);
        assert.equal(component.qualityThresholdApplies, false);
        assert.equal(component.qualityGateFactor, 1);
      }
      assert.equal(ledger.score.terms[0].scoreContribution, .5);
      assert.equal(ledger.score.terms[1].qualityGateFactor, 0);
    }
  } finally { await api(index, { method: 'DELETE' }); }
});

test('real OpenSearch native cutoff scores match component ledgers at every profile, level and count', { skip: !integration, timeout: 300000 }, async () => {
  for (const bucketCount of [16, 64, 256, 1024]) for (const method of CUTOFF_METHODS) for (const { cutoff: pixelCutoff } of CUTOFF_LEVELS) for (const mode of ['vibe', 'proportions']) {
    if (method.profile === 'all-levels' && pixelCutoff !== 0) continue;
    const parameters = { bucketCount, pixelCutoff, minimumQuality: .7, qualityInfluence: 2 };
    const request = mode === 'proportions' ? query : { targets: [{ color: '#ff2200' }, { name: 'dark' }] };
    const search = await executeSearch({ method, query: request, parameters, limit: 2 });
    assert.equal(search.hits.length, 2);
    const result = await inspectCutoff({ method, query: request, parameters, id: search.hits[1].id });
    assert.equal(result.evidence.index, method.metric === 'shade-hue-aware' ? `color-exploration-shade-hue-${bucketCount}-real-v1` : method.metric === 'shade-aware' ? `color-exploration-shade-${bucketCount}-real-v1` : cutoffIndexForCount(bucketCount));
    assert.equal(result.regions.length, bucketCount);
    assert.equal(result.score.actual, search.hits[1].score);
    assert.ok(Math.abs(result.score.difference) < 2e-6, JSON.stringify({ method: method.id, bucketCount, pixelCutoff, mode, score: result.score }));
    assert.ok(Math.abs(result.score.terms.reduce((sum, term) => sum + term.scoreContribution, 0) - result.score.reconstructed) < 1e-12);
    for (const term of result.score.terms) {
      assert.ok(Math.abs(term.components.reduce((sum, component) => sum + component.scoreContribution, 0) - term.scoreContribution) < 1e-12);
      for (const component of term.components) {
        assert.ok(Math.abs(component.scoreContribution - component.areaFactor * component.qualityFactor * component.qualityGateFactor * component.weight) < 1e-12);
        assert.ok(component.physicalCoverage + .0001 >= component.effectiveCoverage);
      }
      if (term.regionIndex != null) {
        const region = result.regions.find(region => region.index === term.regionIndex);
        assert.equal(region.coverage, term.coverage);
        assert.equal(region.conditionalQuality, term.conditionalQuality);
        assert.ok(region.selectedBy.includes(term.targetIndex));
      }
      if (term.components.length > 1) assert.equal(term.areaFactor, null, 'Consensus must not pretend its averaged coverage was scored directly.');
    }
  }
});

test('hard cutoff 50% preserves original global rankings for all banks and both named interpretations', { skip: !integration, timeout: 180000 }, async () => {
  for (const bucketCount of [16, 64, 256, 1024]) for (const [namedMode, original] of [['concrete-swatches', 'overlap-quality-dense'], ['named-families', 'overlap-quality-hybrid']]) {
    for (const query of [{ text: 'red' }, { swatchHex: '#ff2200' }, { mode: 'proportions', targets: [{ name: 'red', percent: 20 }, { name: 'grayscale', percent: 80 }] }]) {
      const options = { query, limit: 545, parameters: { bucketCount, qualityInfluence: 1.5, minimumQuality: .6 } };
      const reference = await executeSearch({ ...options, method: original });
      const current = await executeSearch({ ...options, method: 'cutoff-hard', parameters: { ...options.parameters, namedMode, pixelCutoff: .5 } });
      assert.equal(current.hits.length, 545);
      assert.deepEqual(current.hits, reference.hits, `${bucketCount} ${namedMode} ${JSON.stringify(query)}`);
    }
  }
});

test('real OpenSearch consensus quality gating handles inclusive float32 boundaries and zero targets', { skip: !integration, timeout: 120000 }, async () => {
  const index = `color-exploration-cutoff-quality-test-${process.pid}-${Date.now()}`;
  const parameters = { bucketCount: 16, minimumQuality: .7, qualityInfluence: 0, pixelCutoff: .5 };
  const targets = resolveCutoffTargets('cutoff-consensus', query, { parameters }).targets;
  const baseline = { overlap_pixel_total: 16384, cov_dark: 6000, quality_dark: .8 };
  for (const region of overlapRegionsForCount(16)) for (const { cutoff } of CUTOFF_LEVELS) for (const kernel of ['hard', 'feather', 'core-halo']) {
    const fields = cutoffFields(region.index, kernel, cutoff); baseline[fields.coverage] = 0; baseline[fields.quality] = 0;
  }
  const qualities = { equal: .7, below: .69999994, absent: 0 };
  const properties = Object.fromEntries(Object.keys(baseline).map(field => [field, { type: field.startsWith('quality_') ? 'float' : 'integer' }]));
  await api(index, { method: 'PUT', body: { settings: { number_of_shards: 1, number_of_replicas: 0, 'mapping.total_fields.limit': 2000 }, mappings: { properties: { id: { type: 'keyword' }, ...properties } } } });
  try {
    await bulkIndex(index, Object.entries(qualities).map(([id, quality]) => {
      const document = { id, ...baseline };
      for (const component of targets[0].components) { document[component.coverageField] = id === 'absent' ? 0 : 4000; document[component.qualityField] = quality; }
      // A tiny admitted mass may round to zero basis points while retaining a
      // meaningful weighted mean quality; the ledger must show that stored value.
      if (id === 'equal') document[cutoffFields(targets[0].regionIndex, 'feather', .5).quality] = .9;
      return document;
    }));
    await finishIndex(index);
    const result = await searchIndex(index, buildCutoffQuery({ method: 'cutoff-consensus', query, parameters, limit: 3 }));
    assert.equal(result.hits.length, 3);
    assert.ok(Math.abs(result.hits.find(hit => hit.id === 'equal').score - 1) < 1e-6);
    assert.ok(Math.abs(result.hits.find(hit => hit.id === 'below').score - .5) < 1e-6);
    for (const id of Object.keys(qualities)) {
      const ledger = await inspectCutoff({ method: 'cutoff-consensus', id, index, query, parameters });
      assert.ok(Math.abs(ledger.score.difference) < 2e-6);
      assert.equal(ledger.score.terms[0].components.every(component => component.passesMinimumQuality), id === 'equal');
    }
    const zeroQuery = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 0 }, { name: 'dark', percent: 60 }] };
    const ledger = await inspectCutoff({ method: 'cutoff-consensus', id: 'absent', index, query: zeroQuery, parameters: { ...parameters, minimumQuality: 1 } });
    assert.ok(Math.abs(ledger.score.actual - .5) < 1e-6);
    assert.ok(ledger.score.terms[0].components.every(component => !component.qualityThresholdApplies && component.qualityGateFactor === 1));
    const tiny = await inspectCutoff({ method: 'cutoff-feather', id: 'equal', index, query, parameters });
    assert.equal(tiny.score.terms[0].coverage, 0);
    assert.equal(tiny.score.terms[0].conditionalQuality, Math.fround(.9));
    assert.equal(tiny.regions.find(region => region.index === targets[0].regionIndex).conditionalQuality, Math.fround(.9));
    assert.ok(Math.abs(tiny.score.difference) < 2e-6);
  } finally { await api(index, { method: 'DELETE' }); }
});
