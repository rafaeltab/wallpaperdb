// Display coordinates only. Membership and quality still come from the OKLab region sampler.
const HUE_COLUMNS = 72;
const HUE_STEP = 360 / HUE_COLUMNS;
const AXIS_STEPS = 20;
const wrapHue = hue => ((hue % 360) + 360) % 360;

export function hexToHsl(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Expected a six-digit RGB hex color.');
  const [r, g, b] = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
  const lightness = (high + low) / 2;
  if (delta === 0) return { hue: null, saturation: 0, lightness };
  const sector = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: wrapHue(sector * 60), saturation: delta / (1 - Math.abs(2 * lightness - 1)), lightness };
}

export function colorAtlasGeometry(anchorHex) {
  const anchorHue = anchorHex ? hexToHsl(anchorHex).hue : null;
  // Center chromatic anchors so colors either side of red's 0° seam remain adjacent.
  const hueStart = anchorHue == null ? 0 : wrapHue(anchorHue - 180);
  return {
    columns: HUE_COLUMNS + 1, rows: AXIS_STEPS + 1,
    hueColumns: HUE_COLUMNS, neutralColumn: HUE_COLUMNS,
    hueStart, hueStep: HUE_STEP, axisStep: 1 / AXIS_STEPS,
  };
}

export function layoutMatchingColors(samples, { axis = 'lightness', anchorHex, contextSamples = [] } = {}) {
  if (axis !== 'lightness' && axis !== 'saturation') throw new Error('Color axis must be lightness or saturation.');
  const geometry = colorAtlasGeometry(anchorHex ?? samples.find(sample => sample.isAnchor)?.hex);
  const { columns, rows, hueStart } = geometry;
  const cells = Array(columns * rows).fill(null);
  const add = (source, coordinates) => {
    const sample = { ...source, hsl: hexToHsl(source.hex) };
    const column = coordinates?.column ?? (sample.hsl.hue == null ? HUE_COLUMNS : Math.round(wrapHue(sample.hsl.hue - hueStart) / HUE_STEP) % HUE_COLUMNS);
    const row = coordinates?.row ?? Math.max(0, Math.min(AXIS_STEPS, Math.round(sample.hsl[axis] * AXIS_STEPS)));
    const index = row * columns + column;
    cells[index] ??= { column, row, samples: [], representative: null };
    // Accepted lattice samples are inserted first and retain their anchor/source
    // identity when the reference plane contains the same displayed RGB color.
    if (!cells[index].samples.some(existing => existing.hex === sample.hex)) cells[index].samples.push(sample);
  };
  for (const source of samples) add(source);
  // Fixed plane coordinates matter at zero saturation and black/white endpoints:
  // the actual RGB hue is undefined, but these colors still belong on every
  // nominal hue column of the plane. sample.hsl always reports the actual RGB.
  for (const source of contextSamples) add(source, source);
  for (const cell of cells) {
    if (!cell) continue;
    // Preserve all third-dimension variants for the detail strip, strongest first.
    cell.samples.sort((a, b) => b.quality - a.quality || Number(Boolean(b.isAnchor)) - Number(Boolean(a.isAnchor)) || Number(Boolean(a.contextOnly)) - Number(Boolean(b.contextOnly)) || a.hex.localeCompare(b.hex));
    cell.representative = cell.samples[0];
  }
  return { axis, cells, ...geometry };
}
