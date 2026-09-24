import test from 'node:test';
import assert from 'node:assert/strict';
import { supportsTransport, buildTransportQuery } from './methods-transport.mjs';
import { minCostTransport } from '../proportions.mjs';
import { INDEX, searchIndex, loadFeatures } from './service.mjs';

test('transport explicitly requires exclusive portion targets', () => {
  assert.equal(supportsTransport({ text: 'red' }).supported, false);
  assert.equal(supportsTransport({ mode: 'proportions', overlap: 'marginal', targets: [{ name: 'dark', percent: 80 }, { name: 'red', percent: 80 }] }).supported, false);
  const body = buildTransportQuery({ query: { colorTargets: [{ colorName: 'green', targetImagePercent: 40 }] } });
  assert.equal(body.query.script_score.script.params.remainder, 0.6);
  assert.equal(body.query.script_score.script.params.excessPenalty, 1);
});

test('service transport score agrees with independent residual-network reference', { skip: process.env.COLOR_EXPLORATION_METHOD_INTEGRATION !== '1' }, async () => {
  const features = new Map((await loadFeatures()).map(f => [f.id, f]));
  for (const query of [{ colorTargets: [{ colorName: 'green', targetImagePercent: 40 }] }, { colorTargets: [{ colorName: 'grayscale', targetImagePercent: 80 }, { colorName: 'red', targetImagePercent: 20 }] }]) {
    const body = buildTransportQuery({ query, limit: 5 });
    const params = body.query.script_score.script.params;
    const result = await searchIndex(INDEX, body, { timeoutMs: 120000 });
    assert.equal(result.hits.length, 5);
    for (const hit of result.hits) {
      const f = features.get(hit.id);
      const supplies = f.palette32_packed.map(p => p % 65536 / f.palette_total);
      const demands = [...params.demands, ...(params.remainder > 0 ? [params.remainder] : [])];
      const costs = f.palette32_packed.map(p => {
        const rgb = Math.floor(p / 65536);
        const cell = (rgb >> 20) * 256 + ((rgb >> 12) & 15) * 16 + ((rgb >> 4) & 15);
        const union = Math.max(...params.weights.map(w => w[cell]));
        return demands.map((_, j) => j === params.demands.length ? union * params.excessPenalty : params.weights[j][cell] > 0 ? params.qualityPenalty * (1 - params.qualities[j][cell]) : union > 0 ? 1 : params.outsidePenalty);
      });
      const reference = 1 / (1 + minCostTransport(supplies, demands, costs).cost);
      assert.ok(Math.abs(reference - hit.score) < 2e-6, `${hit.id}: ${reference} != ${hit.score}`);
    }
  }
});
