import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BOUNDS_FILENAME, validateBounds, winningCells, supportsPaletteBounded, searchPaletteBounded, paletteCellIds } from './methods-palette-bounded.mjs';
import { interpretQuery, membership } from './query.mjs';
import { rgbToLab } from './corpus-colors.mjs';
import { INDEX, searchIndex } from './service.mjs';
import { buildDirectPaletteQuery } from './methods-direct-palette.mjs';

test('bounded precision explicitly limits the supported objective', () => {
  assert.equal(supportsPaletteBounded({ swatchHex: '#ff2200' }).supported, true);
  assert.equal(supportsPaletteBounded({ text: 'red' }).supported, false);
  assert.equal(supportsPaletteBounded({ mode: 'proportions', targets: [{ color: '#ff2200', percent: 40 }] }).supported, false);
  assert.deepEqual(paletteCellIds({ palette32_packed: [0xff2200 * 65536 + 100, 0xff2200 * 65536 + 200, 0x123456 * 65536 + 123] }), [0xf20, 0x135]);
});

test('every sampled above-threshold RGB8 centroid survives conservative cell bounds', { skip: process.env.COLOR_EXPLORATION_PALETTE_BOUNDS_TEST !== '1' }, async () => {
  const bounds = validateBounds(JSON.parse(await readFile(BOUNDS_FILENAME, 'utf8')));
  let state = 1234567;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (const hex of ['#ff2200', '#4c8c72', '#808080', '#080808']) {
    const target = interpretQuery({ swatchHex: hex }).targets[0];
    for (const threshold of [0.5, 0.9, 0.99, 1]) {
      const cells = new Set(winningCells({ bounds, target, threshold }).cells);
      for (let sample = 0; sample < 20000; sample++) {
        const rgb8 = random() & 0xffffff;
        const rgb = [(rgb8 >> 16) & 255, (rgb8 >> 8) & 255, rgb8 & 255].map(v => v / 255);
        const cell = (rgb8 >> 20) * 256 + ((rgb8 >> 12) & 15) * 16 + ((rgb8 >> 4) & 15);
        const lab = rgbToLab(rgb), extent = bounds.cells[cell];
        assert.ok(lab.every((value, axis) => value >= extent.min[axis] && value <= extent.max[axis]));
        const match = membership(rgb, target);
        if (match.area && match.quality >= threshold - 2e-6) assert.ok(cells.has(cell), `${hex}: rejected possible winning RGB ${rgb8}`);
      }
    }
  }
});

test('global palette-cell query can return an unseeded winner', async () => {
  const calls = [];
  const fakeBounds = { numericMargin: 2e-6, colorTransformHash: 'test', cells: [{ cell: 123, min: [-2, -2, -2], max: [2, 2, 2] }] };
  const search = async (_index, body) => {
    calls.push(body);
    if (calls.length === 1) return { hits: [{ id: 'seed', score: 0.8 }] };
    if (calls.length === 2) return { hits: [{ id: 'seed', score: 0.9 }] };
    return { hits: [{ id: 'unseeded-winner', score: 0.99 }] };
  };
  const result = await searchPaletteBounded({ index: 'unused', query: { swatchHex: '#ff2200' }, limit: 1, bounds: fakeBounds, search });
  assert.equal(result.hits[0].id, 'unseeded-winner');
  assert.doesNotMatch(JSON.stringify(calls[2]), /"seed"/);
  assert.match(JSON.stringify(calls[2]), /palette_cells/);
});

test('real bounded direct-palette order equals global exhaustive reference', { skip: process.env.COLOR_EXPLORATION_PALETTE_BOUNDS_INTEGRATION !== '1' }, async () => {
  for (const hex of ['#ff2200', '#4c8c72', '#808080', '#080808']) {
    const query = { swatchHex: hex };
    const expected = await searchIndex(INDEX, buildDirectPaletteQuery({ method: 'palette-direct-precision', query, limit: 20 }));
    const actual = await searchPaletteBounded({ index: INDEX, query, limit: 20 });
    assert.deepEqual(actual.hits, expected.hits);
    assert.equal(actual.evidence.finalGloballyEligible, true);
  }
});
