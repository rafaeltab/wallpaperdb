import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePaletteLab, decodePaletteLab, LAB_ERROR, PRECOMPUTED_FIELDS, buildPrecisionPrecomputedQuery, PRECISION_PRECOMPUTED_SCRIPT, searchPrecisionPrecomputedBounded } from './methods-precision-precomputed.mjs';
import { rgbToLab } from './corpus-colors.mjs';
import { buildPrecisionTypedQuery } from './methods-precision-typed.mjs';
import { INDEX, STORE, searchIndex, api } from './service.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

test('paired fixed-point palette doc values preserve sorted slots, exact counts, and bounded coordinates', () => {
  const colors = [0xff2200, 0x010101, 0x000000, 0xffffff, 0x4c8c72];
  const packed = colors.map((rgb, i) => rgb * 65536 + i + 1);
  const encoded = encodePaletteLab({ palette32_packed: packed });
  const decoded = decodePaletteLab(encoded);
  const sorted = [...packed].sort((a, b) => a - b);
  assert.equal(decoded.length, packed.length);
  for (let i = 0; i < sorted.length; i++) {
    const rgb = Math.floor(sorted[i] / 65536);
    const expected = rgbToLab([(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255]);
    assert.equal(decoded[i].slot, i);
    assert.equal(decoded[i].count, sorted[i] % 65536);
    assert.ok(Math.hypot(...expected.map((v, axis) => v - decoded[i].lab[axis])) <= LAB_ERROR);
  }
});

test('fixed-point palette slots retain duplicate numeric doc values and their mass', () => {
  const repeated = 0xff2200 * 65536 + 300;
  const feature = { palette32_packed: [repeated, 15784, repeated] };
  const decoded = decodePaletteLab(encodePaletteLab(feature));
  assert.equal(decoded.length, 3);
  assert.deepEqual(decoded.map(entry => entry.count), [15784, 300, 300]);
  assert.deepEqual(decoded.map(entry => entry.slot), [0, 1, 2]);
  assert.equal(decoded.reduce((sum, entry) => sum + entry.count, 0), 16384);
});

test('precomputed query keeps original anchors and explicitly guards membership boundaries', () => {
  const query = { swatchHex: '#ff2200' };
  const original = buildPrecisionTypedQuery({ query });
  const compiled = buildPrecisionPrecomputedQuery({ query });
  assert.equal(compiled.query.script_score.script.params.anchorL, original.query.script_score.script.params.anchorL);
  assert.equal(compiled.query.script_score.script.params.labError, LAB_ERROR);
  assert.match(PRECISION_PRECOMPUTED_SCRIPT, /Math.abs\(distance - radius\) <= labError/);
  assert.match(PRECISION_PRECOMPUTED_SCRIPT, /palette_lab_lw/);
});

test('precomputed scores stay within the stated tolerance and bounded retrieval is exact for its objective', { skip: process.env.COLOR_EXPLORATION_PRECISION_PRECOMPUTED_TEST !== '1' }, async () => {
  const queries = ['#ff2200', '#4c8c72', '#808080', '#080808'].map(swatchHex => ({ swatchHex }));
  queries.push({ mode: 'vibe', targets: [{ color: '#ff2200', space: 'oklab', tolerance: { distance: 0 }, edgeWeight: 0.5 }] });
  queries.push({ mode: 'vibe', targets: [{ color: '#4c8c72', space: 'oklab', tolerance: { distance: 0.2 }, edgeWeight: 1 }] });
  for (const query of queries) {
    const originalBody = buildPrecisionTypedQuery({ query, limit: 1000 });
    const original = await searchIndex(INDEX, originalBody);
    const actual = await searchIndex(INDEX, buildPrecisionPrecomputedQuery({ query, limit: 1000 }));
    const scores = new Map(original.hits.map(hit => [hit.id, hit.score]));
    const { radius, edgeWeight } = originalBody.query.script_score.script.params;
    const tolerance = radius > 0 ? (1 - edgeWeight) * LAB_ERROR / radius + 2e-7 : 2e-7;
    assert.equal(actual.hits.length, 545);
    for (const hit of actual.hits) assert.ok(Math.abs(hit.score - scores.get(hit.id)) <= tolerance, `${hit.id}: score difference outside ${tolerance}`);
    const bounded = await searchPrecisionPrecomputedBounded({ index: INDEX, query, limit: 20 });
    assert.deepEqual(bounded.hits, actual.hits.slice(0, 20));
  }
});

test('real numeric doc values preserve duplicate entries and precomputed boundary fallback remains aligned', { skip: process.env.COLOR_EXPLORATION_PRECISION_DUPLICATE_TEST !== '1' }, async () => {
  const index = `color-exploration-precomputed-duplicates-${Date.now()}`;
  const repeatedRed = 0xff2200 * 65536 + 300;
  const fixtures = [
    { id: 'duplicate-red', palette32_packed: [repeatedRed, 15784, repeatedRed], palette_total: 16384 },
    { id: 'duplicate-black-before-red', palette32_packed: [0xff2200 * 65536 + 500, 100, 0x00ff00 * 65536 + 15684, 100], palette_total: 16384 },
  ];
  let created = false;
  try {
    await api(index, { method: 'PUT', body: { settings: { number_of_shards: 1, number_of_replicas: 0 }, mappings: { properties: { id: { type: 'keyword' }, palette32_packed: { type: 'long' }, palette_total: { type: 'integer' }, ...PRECOMPUTED_FIELDS } } } });
    created = true;
    const body = fixtures.map(feature => JSON.stringify({ index: { _id: feature.id } }) + '\n' + JSON.stringify({ ...feature, ...encodePaletteLab(feature) }) + '\n').join('');
    const bulk = await api(`${index}/_bulk?refresh=true`, { method: 'POST', body });
    assert.equal(bulk.body.errors, false);
    const stored = await api(`${index}/_search`, { method: 'POST', body: { size: 10, _source: false, docvalue_fields: ['palette32_packed'], sort: [{ id: 'asc' }] } });
    const observed = stored.body.hits.hits.map(hit => ({ id: hit._id, packedValues: hit.fields.palette32_packed }));
    for (const fixture of fixtures) assert.deepEqual(observed.find(doc => doc.id === fixture.id).packedValues, [...fixture.palette32_packed].sort((a, b) => a - b));
    const receipt = { createdAt: new Date().toISOString(), index, numericDocValuesPreserveDuplicates: true, observed, queries: [] };
    await writeFile(path.join(STORE, 'precision-duplicate-probe.json'), JSON.stringify(receipt, null, 2));
    const queries = [
      { swatchHex: '#ff2200' },
      { mode: 'vibe', targets: [{ color: '#ff2200', space: 'oklab', tolerance: { distance: 0 }, edgeWeight: 0.5 }] },
      { mode: 'vibe', targets: [{ color: '#000000', space: 'oklab', tolerance: { distance: 0 }, edgeWeight: 0.5 }] },
    ];
    for (const query of queries) {
      const reference = await searchIndex(index, buildPrecisionTypedQuery({ query, limit: 10 }));
      const actual = await searchIndex(index, buildPrecisionPrecomputedQuery({ query, limit: 10 }));
      const expected = new Map(reference.hits.map(hit => [hit.id, hit.score]));
      for (const hit of actual.hits) assert.ok(Math.abs(hit.score - expected.get(hit.id)) < 4e-6, `Duplicate palette mismatch for ${hit.id}: ${hit.score} vs ${expected.get(hit.id)}`);
      assert.deepEqual(actual.hits.map(hit => hit.id), reference.hits.map(hit => hit.id));
      receipt.queries.push({ query, reference: reference.hits, actual: actual.hits });
    }
    receipt.status = 'all-duplicate-scores-and-boundary-fallbacks-verified';
    receipt.scratchIndexDeletedAfterTest = true;
    await writeFile(path.join(STORE, 'precision-duplicate-probe.json'), JSON.stringify(receipt, null, 2));
  } finally {
    if (created) await api(index, { method: 'DELETE' });
  }
});
