// Distinct precision prototype: indexed fixed-point OKLab, exact edge membership.
import { rgbToLab } from './corpus-colors.mjs';
import { buildPrecisionTypedQuery, supportsPrecisionTyped } from './methods-precision-typed.mjs';
import { prepareCellBounds, searchPaletteBounded } from './methods-palette-bounded.mjs';

export const LAB_STEP = 1e-6;
export const LAB_ERROR = Math.sqrt(3) * LAB_STEP / 2 + 1e-10;
export const PRECOMPUTED_FIELDS = Object.freeze({ palette_lab_lw: { type: 'long' }, palette_lab_ab: { type: 'long' } });
const limitations = [
  'Supports one picked-hex vibe target with an OKLab radius.',
  'OKLab components are rounded to 1e-6; quality scores can change slightly. Range-edge membership falls back to original RGB arithmetic.',
  'The original 32-color palette remains an approximation of image pixels.',
];
export const PRECISION_PRECOMPUTED_METHODS = Object.freeze([
  { id: 'palette-precision-precomputed', label: 'Picked precision with indexed OKLab centroids', family: 'direct-palette', representation: 'palette32-oklab-fixed', searchKind: 'precision-precomputed', approximate: false, requiredFields: ['palette32_packed', 'palette_total', ...Object.keys(PRECOMPUTED_FIELDS)], limitations },
  { id: 'palette-precision-bounded-precomputed', label: 'Indexed OKLab precision with conservative palette bounds', family: 'palette-bounded', representation: 'palette32-oklab-fixed', searchKind: 'precision-bounded-precomputed', approximate: false, requiredFields: ['palette32_packed', 'palette_total', 'palette_cells', ...Object.keys(PRECOMPUTED_FIELDS)], limitations: [...limitations, 'Pruning is exact for the stored-coordinate objective, with an extra conservative rounding margin and a stable-index requirement.'] },
]);

export function encodePaletteLab(feature) {
  // SortedNumericDocValues retain repeated values. Every occurrence needs a slot
  // so its mass and original-RGB boundary fallback remain aligned.
  const packed = [...feature.palette32_packed].sort((a, b) => a - b);
  if (packed.length > 32) throw new Error('Expected at most 32 palette centroids');
  const result = { palette_lab_lw: [], palette_lab_ab: [] };
  for (let slot = 0; slot < packed.length; slot++) {
    const rgb = Math.floor(packed[slot] / 65536), count = packed[slot] % 65536;
    const lab = rgbToLab([(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255]);
    const [l, a, b] = lab.map((v, axis) => Math.round((v + (axis ? 0.5 : 0)) / LAB_STEP));
    if (!Number.isInteger(count) || count <= 0 || count >= 32768 || [l, a, b].some(v => v < 0 || v >= 1048576)) throw new Error('Palette centroid does not fit the fixed-point encoding');
    result.palette_lab_lw.push(slot * 34359738368 + l * 32768 + count);
    result.palette_lab_ab.push(slot * 1099511627776 + a * 1048576 + b);
  }
  return result;
}

export function decodePaletteLab(encoded) {
  return encoded.palette_lab_lw.map((lw, i) => {
    const ab = encoded.palette_lab_ab[i], slot = Math.floor(lw / 34359738368);
    if (Math.floor(ab / 1099511627776) !== slot) throw new Error('Palette slot mismatch');
    return { slot, count: lw % 32768, lab: [Math.floor(lw / 32768) % 1048576 * LAB_STEP, (Math.floor(ab / 1048576) % 1048576) * LAB_STEP - 0.5, ab % 1048576 * LAB_STEP - 0.5] };
  });
}

export const PRECISION_PRECOMPUTED_SCRIPT = `def paletteLW = doc['palette_lab_lw'];
def paletteAB = doc['palette_lab_ab'];
def originalPalette = doc['palette32_packed'];

double anchorL = params.anchorL;
double anchorA = params.anchorA;
double anchorB = params.anchorB;
double radius = params.radius;
double edgeWeight = params.edgeWeight;
double minimumSupport = params.minimumSupport;
double labError = params.labError;
double total = doc['palette_total'].value;
double area = 0.0;
double qualityMass = 0.0;
int count = paletteLW.size();
for (int i = 0; i < count; i++) {
  long lw = paletteLW.get(i);
  long ab = paletteAB.get(i);
  double mass = (lw & 32767L) / total;
  double labL = ((lw >> 15) & 1048575L) * 0.000001;
  double labA = ((ab >> 20) & 1048575L) * 0.000001 - 0.5;
  double labB = (ab & 1048575L) * 0.000001 - 0.5;
  double dl = labL - anchorL;
  double da = labA - anchorA;
  double db = labB - anchorB;
  double distance = Math.sqrt(dl * dl + da * da + db * db);
  // Rounded coordinates must not decide which side of a discontinuous edge wins.
  if (Math.abs(distance - radius) <= labError + 1e-8) {
    long original = originalPalette.get(i);
    long rgb = original / 65536L;
    double r = ((rgb >> 16) & 255) / 255.0;
    double g = ((rgb >> 8) & 255) / 255.0;
    double b = (rgb & 255) / 255.0;
    double rr = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    double gg = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    double bb = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
    double ll = Math.cbrt(0.4122214708 * rr + 0.5363325363 * gg + 0.0514459929 * bb);
    double mm = Math.cbrt(0.2119034982 * rr + 0.6806995451 * gg + 0.1073969566 * bb);
    double ss = Math.cbrt(0.0883024619 * rr + 0.2817188376 * gg + 0.6299787005 * bb);
    dl = 0.2104542553 * ll + 0.793617785 * mm - 0.0040720468 * ss - anchorL;
    da = 1.9779984951 * ll - 2.428592205 * mm + 0.4505937099 * ss - anchorA;
    db = 0.0259040371 * ll + 0.7827717662 * mm - 0.808675766 * ss - anchorB;
    distance = Math.sqrt(dl * dl + da * da + db * db);
  }
  double normalized = radius > 0 ? distance / radius : distance < 1e-8 ? 0.0 : 1e30;
  if (normalized <= 1.0 + 1e-9) {
    area += mass;
    qualityMass += mass * (1.0 - (1.0 - edgeWeight) * Math.min(1.0, normalized));
  }
}
double quality = area > 0 ? qualityMass / area : 0.0;
return Math.min(1.0, area / minimumSupport) * quality;
`;

export function supportsPrecisionPrecomputed(query) {
  const result = supportsPrecisionTyped(query);
  return result.supported ? { ...result, warnings: limitations } : result;
}
export function buildPrecisionPrecomputedQuery(options) {
  const body = buildPrecisionTypedQuery(options);
  body.query.script_score.script.source = PRECISION_PRECOMPUTED_SCRIPT;
  body.query.script_score.script.params.labError = LAB_ERROR;
  return body;
}
let boundsPromise;
export async function searchPrecisionPrecomputedBounded(options) {
  boundsPromise ??= prepareCellBounds();
  const originalBounds = options.bounds ?? await boundsPromise;
  const expandedBounds = { ...originalBounds, numericMargin: originalBounds.numericMargin + LAB_ERROR };
  const result = await searchPaletteBounded({ ...options, bounds: expandedBounds, buildExactQuery: buildPrecisionPrecomputedQuery });
  return { ...result, evidence: { ...result.evidence, exactScorer: 'palette-precision-precomputed', coordinateStep: LAB_STEP, coordinateDistanceErrorBound: LAB_ERROR, additionalPruningDistanceMargin: 2 * LAB_ERROR } };
}
