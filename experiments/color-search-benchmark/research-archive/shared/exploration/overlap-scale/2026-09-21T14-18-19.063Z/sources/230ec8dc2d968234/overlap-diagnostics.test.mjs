import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverlapInspectionQuery, inspectOverlap } from './overlap-diagnostics.mjs';
import { OVERLAP_METHODS, buildOverlapQuery, resolveOverlapTargets } from './methods-overlap.mjs';
import { OVERLAP_INDEX } from './overlap-index.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { buildNativeRefinedQuery } from './methods-native-refined.mjs';
import { INDEX, api, searchIndex } from './service.mjs';

const red = { targets: [{ color: '#ff2200' }] };
const proportion = targets => ({ mode: 'proportions', targets });

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

const integration = process.env.COLOR_OVERLAP_INTEGRATION === '1';
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
