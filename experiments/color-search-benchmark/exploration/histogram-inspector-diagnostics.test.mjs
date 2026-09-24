import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistogramInspectionQuery, inspectHistogram, INSPECTOR_METHOD } from './histogram-inspector-diagnostics.mjs';
import { buildFastQuery } from './methods-fast.mjs';
import { executeSearch } from './registry.mjs';
import { INDEX, api, loadFeatures } from './service.mjs';

const red = { mode: 'vibe', targets: [{ name: 'red' }] };
const portions = targets => ({ mode: 'proportions', targets });

test('inspection preserves the real typed scorer and closed/partial intent parameters', () => {
  for (const query of [red, portions([{ name: 'green', percent: 40 }]), portions([{ name: 'grayscale', percent: 80 }, { name: 'red', percent: 20 }])]) {
    const body = buildHistogramInspectionQuery({ id: 'wallpaper-042', query });
    const params = body.query.script_score.script.params;
    assert.equal(params.areaPower, .65);
    assert.equal(params.qualityPenalty, .1);
    assert.equal(params.excessPenalty, 1.5);
    assert.equal(params.outsidePenalty, params.remainder > 0 ? 0 : 6);
    const reference = buildFastQuery({ method: 'histogram-composition-typed', query, limit: 1, filter: { ids: { values: ['wallpaper-042'] } }, parameters: params });
    assert.deepEqual(body.query, reference.query);
    assert.deepEqual(body.script_fields.histogram_diagnostics.script.params, params);
    assert.equal(body._source, false);
  }
});

test('inspection preserves subject filtering and rejects unsupported input before service access', () => {
  const body = buildHistogramInspectionQuery({ id: 'x', query: { ...red, subject: 'city' } });
  assert.deepEqual(body.query.script_score.query.bool.filter, [{ ids: { values: ['x'] } }, { term: { tags: 'city' } }]);
  assert.throws(() => buildHistogramInspectionQuery({ id: '', query: red }), /wallpaper ID/i);
  assert.throws(() => buildHistogramInspectionQuery({ id: 'x', query: { mode: 'unknown' } }), /Mode/);
});

const integration = process.env.COLOR_HISTOGRAM_INSPECTOR_INTEGRATION === '1';
test('real OpenSearch inspection reconstructs unchanged scores, complete bins and nonlinear terms', { skip: !integration, timeout: 120000 }, async () => {
  const features = await loadFeatures();
  const photo = features.find(f => f.id.includes('042')) ?? features[0];
  const cases = [
    red,
    portions([{ name: 'green', percent: 40 }]),
    portions([{ name: 'grayscale', percent: 80 }, { name: 'red', percent: 20 }]),
    portions([{ name: 'grayscale', percent: 80 }, { name: 'red', percent: 10 }]),
    { mode: 'vibe', targets: [{ name: 'grayscale' }, { name: 'red' }] },
    { mode: 'vibe', targets: [{ name: 'dark' }, { name: 'bright' }] },
    { mode: 'vibe', targets: [{ color: '#ff2200', tolerance: { distance: 0 } }] },
  ];
  for (const query of cases) {
    const result = await inspectHistogram({ id: photo.id, query });
    const reference = await executeSearch({ index: INDEX, method: INSPECTOR_METHOD, query, limit: 1, filter: { ids: { values: [photo.id] } } });
    assert.equal(result.score.actual, reference.hits[0].score);
    assert.ok(Math.abs(result.score.difference) < 2e-6, JSON.stringify(result.score));
    assert.equal(result.bins.length, 4096);
    assert.equal(new Set(result.bins.map(b => b.index)).size, 4096);
    assert.equal(result.bins.reduce((sum, b) => sum + b.count, 0), result.totals.pixelCount);
    assert.equal(result.bins.filter(b => b.occupied).length, result.totals.occupiedBinCount);
    for (let target = 0; target < result.compiled.targets.length; target++) {
      assert.ok(Math.abs(result.bins.reduce((sum, b) => sum + b.targets[target].areaContribution, 0) - result.totals.targetAreas[target]) < 1e-10);
      assert.ok(Math.abs(result.bins.reduce((sum, b) => sum + b.targets[target].qualityMassContribution, 0) - result.totals.qualityMasses[target]) < 1e-10);
    }
    for (const bin of result.bins) {
      if (!bin.occupied) {
        assert.equal(bin.leaveOneOutEffect, 0);
        assert.equal(bin.scoreWithoutBin, result.score.reconstructed);
      } else if (bin.coverage < 1) {
        assert.ok(Number.isFinite(bin.leaveOneOutEffect));
        assert.ok(Math.abs(result.score.reconstructed - bin.scoreWithoutBin - bin.leaveOneOutEffect) < 1e-12);
      }
    }
    if (result.score.formulaKind === 'proportions') assert.ok(Math.abs(1 / (1 + result.score.terms.totalError) - result.score.reconstructed) < 1e-12);
    if (query.targets[0].tolerance?.distance === 0) {
      assert.equal(result.score.actual, 0);
      assert.ok(result.bins.every(b => b.leaveOneOutEffect === 0));
    }
  }
  await assert.rejects(inspectHistogram({ id: 'nonexistent-inspector-wallpaper', query: red }), /not found|not eligible/i);
});

test('leave-one-out matches a separately executed OpenSearch histogram and all-mass removal is undefined', { skip: !integration, timeout: 120000 }, async () => {
  const features = await loadFeatures();
  const fixture = features.find(f => f.rgb4096.length <= 3) ?? features[0];
  const query = portions([{ name: 'grayscale', percent: 80 }, { name: 'red', percent: 20 }]);
  const result = await inspectHistogram({ id: fixture.id, query });
  for (const bin of result.bins.filter(b => b.occupied).slice(0, 3)) {
    if (bin.coverage === 1) {
      assert.equal(bin.leaveOneOutEffect, null);
      assert.equal(bin.scoreWithoutBin, null);
      continue;
    }
    // Rerun the existing scorer in OpenSearch, excluding this bin while gathering.
    // The diagnostic's subtract-and-rescale implementation is checked independently.
    const body = buildHistogramInspectionQuery({ id: fixture.id, query });
    delete body.script_fields;
    const script = body.query.script_score.script;
    script.params.removeCell = bin.index;
    script.params.remainingPixels = result.totals.pixelCount - bin.count;
    script.source = script.source.replace("double total = doc['pixel_total'].value;", 'double total = params.remainingPixels;')
      .replace('double mass = (packed % 65536L) / total;', 'if (cell == params.removeCell) continue;\n  double mass = (packed % 65536L) / total;');
    const response = await api(`${INDEX}/_search`, { method: 'POST', body });
    assert.ok(Math.abs(response.body.hits.hits[0]._score - bin.scoreWithoutBin) < 2e-6);
  }
  const soleBinAsset = features.find(f => f.rgb4096.length === 1);
  assert.ok(soleBinAsset, 'The real corpus must include the known one-bin asset for this check.');
  const soleBinResult = await inspectHistogram({ id: soleBinAsset.id, query });
  const onlyBin = soleBinResult.bins.find(bin => bin.occupied);
  assert.equal(soleBinResult.totals.occupiedBinCount, 1);
  assert.equal(onlyBin.coverage, 1);
  assert.equal(onlyBin.scoreWithoutBin, null);
  assert.equal(onlyBin.leaveOneOutEffect, null);
});
