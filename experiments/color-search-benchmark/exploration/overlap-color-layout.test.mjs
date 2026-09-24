import assert from 'node:assert/strict';
import test from 'node:test';
import { hexToHsl, layoutMatchingColors } from './web/overlap-color-layout.mjs';

const sample = (hex, quality = .75, other = {}) => ({ hex, quality, distance: .06, ...other });
const occupied = layout => layout.cells.filter(Boolean);

test('HSL axes use RGB hue and lightness, with no hue assigned to exact grays', () => {
  for (const [hex, hue] of [['#ff0000', 0], ['#ffff00', 60], ['#00ff00', 120], ['#00ffff', 180], ['#0000ff', 240], ['#ff00ff', 300]]) {
    assert.deepEqual(hexToHsl(hex), { hue, saturation: 1, lightness: .5 });
  }
  assert.deepEqual(hexToHsl('#000000'), { hue: null, saturation: 0, lightness: 0 });
  assert.deepEqual(hexToHsl('#FFFFFF'), { hue: null, saturation: 0, lightness: 1 });
  assert.deepEqual(hexToHsl('#808080'), { hue: null, saturation: 0, lightness: 128 / 255 });
  assert.notEqual(hexToHsl('#808081').hue, null);
});

test('the atlas stays wide with a dedicated neutral column and fixed coordinate steps', () => {
  const layout = layoutMatchingColors([sample('#ff0000')], { anchorHex: '#ff0000' });
  assert.equal(layout.columns, 73);
  assert.equal(layout.hueColumns, 72);
  assert.equal(layout.neutralColumn, 72);
  assert.equal(layout.rows, 21);
  assert.equal(layout.cells.length, 73 * 21);
  assert.equal(layout.axis, 'lightness');
  assert.equal(layout.hueStep, 5);
  assert.equal(layout.axisStep, .05);
  assert.equal(layout.hueStart, 180);
  assert.deepEqual(occupied(layout).map(cell => [cell.column, cell.row]), [[36, 10]]);
});

test('a red anchor centers the hue seam so nearby red hues are together', () => {
  const layout = layoutMatchingColors([sample('#ff0000'), sample('#ff0004'), sample('#ff0400')], { anchorHex: '#ff0000' });
  assert.equal(occupied(layout).length, 1);
  assert.equal(occupied(layout)[0].column, 36);
  assert.equal(occupied(layout)[0].samples.length, 3);
  const grayAnchor = layoutMatchingColors([sample('#ff0000'), sample('#808080')], { anchorHex: '#808080' });
  assert.equal(grayAnchor.hueStart, 0);
  assert.equal(occupied(grayAnchor).find(cell => cell.representative.hex === '#808080').column, 72);
});

test('lightness rows increase from black at the top to white at the bottom', () => {
  const layout = layoutMatchingColors(['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff'].map(hex => sample(hex)), { axis: 'lightness' });
  assert.deepEqual(occupied(layout).map(cell => cell.row), [0, 5, 10, 15, 20]);
  assert.ok(occupied(layout).every(cell => cell.column === 72));
  assert.deepEqual(occupied(layout).map(cell => cell.samples[0].hsl.lightness), [0, 64 / 255, 128 / 255, 191 / 255, 1]);
});

test('saturation rows increase independently of lightness and preserve neutral colors', () => {
  const samples = ['#808080', '#996666', '#b34d4d', '#cc3333', '#e61919', '#ff0000', '#800000'].map(hex => sample(hex));
  const layout = layoutMatchingColors(samples, { axis: 'saturation', anchorHex: '#ff0000' });
  assert.deepEqual(occupied(layout).map(cell => cell.row), [0, 4, 8, 12, 16, 20]);
  assert.equal(occupied(layout)[0].column, 72);
  assert.ok(occupied(layout).slice(1).every(cell => cell.column === 36));
  assert.deepEqual(occupied(layout).at(-1).samples.map(item => item.hex), ['#800000', '#ff0000']);
});

test('each sample is retained exactly once and cells use the strongest match', () => {
  const samples = [sample('#ff0000', 1, { isAnchor: true }), sample('#fe0101', .9), sample('#ff0001', .6), sample('#888888', .5)];
  const before = structuredClone(samples);
  const layout = layoutMatchingColors(samples, { anchorHex: '#ff0000' });
  const allSamples = occupied(layout).flatMap(cell => cell.samples);
  assert.deepEqual(allSamples.map(item => item.hex).sort(), samples.map(item => item.hex).sort());
  assert.deepEqual(samples, before);
  for (const item of allSamples) {
    const original = samples.find(value => value.hex === item.hex);
    assert.notEqual(item, original);
    assert.equal(item.quality, original.quality);
    assert.equal(item.distance, original.distance);
  }
  const anchorCell = occupied(layout).find(cell => cell.samples.some(item => item.isAnchor));
  assert.equal(anchorCell.representative.hex, '#ff0000');
  assert.equal(anchorCell.representative, anchorCell.samples[0]);
  const withoutAnchor = layoutMatchingColors(samples.slice(1), { anchorHex: '#ff0000' });
  assert.equal(occupied(withoutAnchor).find(cell => cell.column === 36).representative.hex, '#fe0101');
});

test('both tabs preserve accepted samples and their original quality', () => {
  const samples = [sample('#ff0000', .99), sample('#800000', .6), sample('#ffffff', .5), sample('#808080', .7), sample('#000000', 1), sample('#0000ff', .85)];
  for (const axis of ['lightness', 'saturation']) {
    const layout = layoutMatchingColors(samples, { axis, anchorHex: '#800000' });
    for (const cell of occupied(layout)) {
      assert.equal(layout.cells[cell.row * layout.columns + cell.column], cell);
      assert.ok(cell.row >= 0 && cell.row <= 20);
      assert.ok(cell.column >= 0 && cell.column <= 72);
    }
    assert.deepEqual(occupied(layout).flatMap(cell => cell.samples.map(({ hex, quality }) => [hex, quality])).sort(), samples.map(({ hex, quality }) => [hex, quality]).sort());
  }
});

test('invalid axis is rejected instead of silently mislabeled', () => {
  assert.throws(() => layoutMatchingColors([], { axis: 'quality' }), /lightness or saturation/);
});

test('context colors fill nominal positions even when RGB hue is undefined', () => {
  const contextSamples = [
    sample('#000000', 0, { column: 0, row: 0, contextOnly: true, matches: false }),
    sample('#000000', 0, { column: 36, row: 0, contextOnly: true, matches: false }),
    sample('#808080', 0, { column: 36, row: 10, contextOnly: true, matches: false }),
  ];
  const before = structuredClone(contextSamples);
  const layout = layoutMatchingColors([], { anchorHex: '#ff0000', contextSamples });
  assert.deepEqual(occupied(layout).map(cell => [cell.column, cell.row]), [[0, 0], [36, 0], [36, 10]]);
  assert.ok(occupied(layout).every(cell => cell.representative.hsl.hue === null));
  assert.ok(occupied(layout).every(cell => cell.representative.quality === 0));
  assert.deepEqual(contextSamples, before);
});

test('context and measured membership examples merge without hiding real matches or duplicating a hex', () => {
  const contextSamples = [
    sample('#ff0000', 1, { column: 36, row: 10, contextOnly: true, matches: true }),
    sample('#ff0100', .9, { column: 36, row: 10, contextOnly: true, matches: true }),
    sample('#ff0001', .9, { column: 36, row: 10, contextOnly: true, matches: true }),
    sample('#0000ff', 0, { column: 12, row: 10, contextOnly: true, matches: false }),
  ];
  const samples = [sample('#ff0000', 1, { isAnchor: true }), sample('#ff0001', .9)];
  const layout = layoutMatchingColors(samples, { anchorHex: '#ff0000', contextSamples });
  const redCell = occupied(layout).find(cell => cell.column === 36);
  assert.equal(redCell.representative.isAnchor, true);
  assert.equal(redCell.representative.contextOnly, undefined);
  assert.equal(redCell.samples.length, 3);
  assert.equal(redCell.samples.find(item => item.hex === '#ff0001').contextOnly, undefined);
  const blueCell = occupied(layout).find(cell => cell.column === 12);
  assert.equal(blueCell.representative.hex, '#0000ff');
  assert.equal(blueCell.representative.quality, 0);
});

test('matching reference colors keep their true quality when the original lattice missed their cell', () => {
  const contextSamples = [sample('#ff0000', .8, { column: 36, row: 10, contextOnly: true, matches: true })];
  const layout = layoutMatchingColors([], { anchorHex: '#ff0000', contextSamples });
  assert.equal(occupied(layout)[0].representative.quality, .8);
  assert.equal(occupied(layout)[0].representative.matches, true);
});
