import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretQuery } from './query.mjs';
import { supports, executeSearch } from './registry.mjs';
import { BASE, INDEX } from './service.mjs';

const cases = [
  { special: 'dark_bright_accents', text: 'Mostly dark, with small bright areas', names: ['dark', 'bright'], colors: ['#101014', '#fff6cc'] },
  { special: 'gray_red_accents', text: 'Mostly grayscale, with red accents', names: ['grayscale', 'red'], colors: ['#808080', '#ed3030'] },
];
const structured = entry => ({ mode: 'vibe', targets: entry.names.map((name, i) => ({ name, color: entry.colors[i], edgeWeight: 0.5 })) });

test('structured named accent pairs use the same intent and order as evaluated text', () => {
  for (const entry of cases) {
    const legacy = interpretQuery({ text: entry.text });
    assert.equal(legacy.special, entry.special);
    for (const targets of [structured(entry).targets, structured(entry).targets.reverse()]) {
      const compiled = interpretQuery({ mode: 'vibe', targets });
      assert.equal(compiled.special, entry.special);
      assert.deepEqual(compiled.targets.map(target => target.name), entry.names);
      assert.equal(compiled.mode, 'vibe');
    }
  }
});

test('explicit proportions, custom ranges, duplicate names, and larger combinations remain ordinary queries', () => {
  for (const entry of cases) {
    const targets = structured(entry).targets;
    assert.equal(interpretQuery({ mode: 'proportions', targets: targets.map(target => ({ ...target, percent: 40 })) }).special, null);
    assert.equal(interpretQuery({ mode: 'vibe', targets: targets.map(target => ({ ...target, space: 'oklab', tolerance: { distance: 0.2 } })) }).special, null);
    assert.equal(interpretQuery({ mode: 'vibe', targets: [...targets, { name: 'green' }] }).special, null);
    assert.equal(interpretQuery({ mode: 'vibe', targets: [targets[0], targets[0]] }).special, null);
  }
});

test('support status no longer depends on whether an accent query came from the browser', () => {
  for (const entry of cases) for (const method of ['rank-features-area', 'rank-features-vibe', 'native-quality-linear', 'native-quality-asymmetric']) {
    assert.equal(supports(method, { text: entry.text }).supported, false);
    assert.equal(supports(method, structured(entry)).supported, false);
  }
});

test('pure area methods explicitly disclose ignored edge quality for custom ranges', () => {
  const query = { mode: 'vibe', targets: [{ color: '#ff0000', space: 'oklab', tolerance: { distance: 0.3 }, edgeWeight: 0.1 }] };
  for (const method of ['histogram-area-exact', 'palette-area-exact', 'histogram-area-typed', 'palette-area-typed']) {
    const result = supports(method, query);
    assert.equal(result.supported, true);
    assert.ok(result.warnings.some(warning => /ignores color quality and edge falloff/.test(warning)), method);
  }
  assert.ok(!supports('histogram-composition-typed', query).warnings.some(warning => /ignores color quality and edge falloff/.test(warning)));
});

test('actual OpenSearch accent results match across text and both browser target orders', { skip: process.env.COLOR_EXPLORATION_ACCENT_INTEGRATION !== '1' }, async () => {
  assert.equal(new URL(BASE).port, '19216', 'This regression probe only uses the small real-corpus service.');
  for (const entry of cases) for (const method of ['feature-composition-exact', 'native-area-linear', 'palette-direct-precision', 'histogram-composition-typed', 'hybrid-relative-accents']) {
    const legacy = await executeSearch({ index: INDEX, method, query: { text: entry.text }, limit: 545 });
    for (const targets of [structured(entry).targets, structured(entry).targets.reverse()]) {
      const result = await executeSearch({ index: INDEX, method, query: { mode: 'vibe', targets }, limit: 545 });
      assert.deepEqual(result.hits, legacy.hits, `${method}: ${entry.special}: all corpus scores and order must agree`);
    }
  }
});
