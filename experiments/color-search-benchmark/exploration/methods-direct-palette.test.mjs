import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectPaletteQuery, supportsDirectPalette } from './methods-direct-palette.mjs';
import { FEATURE_NAMES } from './corpus-colors.mjs';
import { interpretQuery, membership } from './query.mjs';
import { INDEX, searchIndex, loadFeatures } from './service.mjs';

test('direct palette retains RGB24 comparisons and rejects undefined hue ranges', () => {
  const body = buildDirectPaletteQuery({ query: { swatchHex: '#ff2200' }, method: 'palette-direct-precision' });
  assert.equal(body.query.script_score.script.params.shadeFirst, true);
  assert.equal(body.query.script_score.script.params.minimumSupport, 0.05);
  assert.equal(body.query.script_score.script.params.targets[0].ranges[0].space, 0);
  assert.doesNotMatch(body.query.script_score.script.source, /params\.weights/);
  assert.equal(supportsDirectPalette({ mode: 'vibe', targets: [{ color: '#000000', space: 'hsl', tolerance: { h: 0.1, s: 0.02, l: 0.1 } }] }).supported, false);
});

test('direct service membership and quality match independent JS for every pixel family and range space', { skip: process.env.COLOR_EXPLORATION_DIRECT_TEST !== '1' }, async () => {
  const features = (await loadFeatures()).slice(0, 12);
  const queries = FEATURE_NAMES.filter(n => !['monochromatic', 'rainbow'].includes(n)).map(name => ({ mode: 'vibe', targets: [{ name }] }));
  queries.push(...[
    { color: '#ef2020', space: 'oklab', tolerance: { distance: 0.2 } },
    { color: '#4c8c72', space: 'rgb', tolerance: { r: 0.2, g: 0.2, b: 0.2 } },
    { color: '#209040', space: 'hsv', tolerance: { h: 0.3, s: 0.5, v: 0.4 } },
    { color: '#000000', space: 'hsl', tolerance: { h: 1, s: 0.02, l: 0.4 } },
  ].map(t => ({ mode: 'vibe', targets: [t] })));
  for (const query of queries) {
    const target = interpretQuery(query).targets[0];
    for (const diagnostic of ['area', 'quality']) {
      const body = buildDirectPaletteQuery({ query, eligibleIds: features.map(f => f.id), limit: 20 });
      body.query.script_score.script.params.diagnostic = diagnostic;
      const result = await searchIndex(INDEX, body);
      assert.equal(result.hits.length, features.length);
      const values = new Map(result.hits.map(h => [h.id, h.score]));
      for (const feature of features) {
        let area = 0, qualityMass = 0;
        for (const packed of feature.palette32_packed) {
          const rgb24 = Math.floor(packed / 65536);
          const rgb = [(rgb24 >> 16) & 255, (rgb24 >> 8) & 255, rgb24 & 255].map(v => v / 255);
          const mass = packed % 65536 / feature.palette_total;
          const actual = membership(rgb, target);
          area += mass * actual.area; qualityMass += mass * actual.area * actual.quality;
        }
        const expected = diagnostic === 'area' ? area : area > 0 ? qualityMass / area : 0;
        assert.ok(Math.abs(values.get(feature.id) - expected) < 2e-6, `${feature.id}, ${target.name ?? target.color}, ${diagnostic}: ${values.get(feature.id)} != ${expected}`);
      }
    }
  }
});

test('shade-first support saturation does not reward a larger exact-color rectangle', { skip: process.env.COLOR_EXPLORATION_DIRECT_TEST !== '1' }, async () => {
  const ids = ['precision-shade-001-a', 'precision-shade-001-b', 'precision-shade-001-c', 'precision-shade-001-d'];
  const result = await searchIndex(INDEX, buildDirectPaletteQuery({ method: 'palette-direct-precision', query: { swatchHex: '#ff2200' }, eligibleIds: ids, limit: 4 }));
  const scores = Object.fromEntries(result.hits.map(h => [h.id.at(-1), h.score]));
  assert.ok(Math.abs(scores.b - scores.d) < 0.03);
  assert.ok(scores.b > scores.a && scores.b > scores.c);
  assert.ok(scores.d > scores.a && scores.d > scores.c);
});
