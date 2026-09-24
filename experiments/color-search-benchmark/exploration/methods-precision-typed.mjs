// Typed specialization of the existing single picked-color direct palette formula.
import { buildDirectPaletteQuery } from './methods-direct-palette.mjs';
import { supportsPaletteBounded, searchPaletteBounded } from './methods-palette-bounded.mjs';

const limitations = [
  'Only one picked-hex vibe target with an OKLab radius is supported.',
  'The formula and original RGB24 palette are unchanged; this only specializes Painless execution.',
  'Palette compression remains an approximation of the image pixels.',
];
export const PRECISION_TYPED_METHODS = Object.freeze([
  { id: 'palette-precision-typed', label: 'Direct picked-color precision, typed Painless', family: 'direct-palette', representation: 'palette32-direct', approximate: false, searchKind: 'precision-typed', limitations },
  { id: 'palette-precision-bounded-typed', label: 'Typed precision with exact indexed palette bounds', family: 'palette-bounded', representation: 'palette32-direct', approximate: false, searchKind: 'precision-bounded-typed',
    requiredFields: ['palette32_packed', 'palette_total', 'palette_cells'],
    limitations: [...limitations, 'The global pruning proof and stable-index requirement are identical to the generic bounded precision method.'] },
]);

export const PRECISION_TYPED_SCRIPT = `
double anchorL = params.anchorL;
double anchorA = params.anchorA;
double anchorB = params.anchorB;
double radius = params.radius;
double edgeWeight = params.edgeWeight;
double minimumSupport = params.minimumSupport;
double total = doc['palette_total'].value;
double area = 0.0;
double qualityMass = 0.0;
int count = doc['palette32_packed'].size();
for (int i = 0; i < count; i++) {
  long packed = doc['palette32_packed'].get(i);
  long rgb = packed / 65536L;
  double mass = (packed % 65536L) / total;
  double r = ((rgb >> 16) & 255) / 255.0;
  double g = ((rgb >> 8) & 255) / 255.0;
  double b = (rgb & 255) / 255.0;
  double rr = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  double gg = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  double bb = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  double ll = Math.cbrt(0.4122214708 * rr + 0.5363325363 * gg + 0.0514459929 * bb);
  double mm = Math.cbrt(0.2119034982 * rr + 0.6806995451 * gg + 0.1073969566 * bb);
  double ss = Math.cbrt(0.0883024619 * rr + 0.2817188376 * gg + 0.6299787005 * bb);
  double labL = 0.2104542553 * ll + 0.793617785 * mm - 0.0040720468 * ss;
  double labA = 1.9779984951 * ll - 2.428592205 * mm + 0.4505937099 * ss;
  double labB = 0.0259040371 * ll + 0.7827717662 * mm - 0.808675766 * ss;
  double dl = labL - anchorL;
  double da = labA - anchorA;
  double db = labB - anchorB;
  double distance = Math.sqrt(dl * dl + da * da + db * db);
  double normalized = radius > 0 ? distance / radius : distance < 1e-8 ? 0.0 : 1e30;
  if (normalized <= 1.0 + 1e-9) {
    area += mass;
    qualityMass += mass * (1.0 - (1.0 - edgeWeight) * Math.min(1.0, normalized));
  }
}
double quality = area > 0 ? qualityMass / area : 0.0;
return Math.min(1.0, area / minimumSupport) * quality;
`;

export function supportsPrecisionTyped(query) {
  const check = supportsPaletteBounded(query);
  return check.supported ? { ...check, warnings: limitations } : check;
}

export function buildPrecisionTypedQuery(options) {
  const check = supportsPrecisionTyped(options.query);
  if (!check.supported) throw new Error(check.reason);
  const body = buildDirectPaletteQuery({ ...options, method: 'palette-direct-precision' });
  const generic = body.query.script_score.script.params;
  const target = generic.targets[0];
  body.query.script_score.script = { lang: 'painless', source: PRECISION_TYPED_SCRIPT, params: {
    anchorL: target.lab[0], anchorA: target.lab[1], anchorB: target.lab[2],
    radius: target.ranges[0].widths[0], edgeWeight: target.edgeWeight, minimumSupport: generic.minimumSupport,
  } };
  return body;
}

export async function searchPrecisionTypedBounded(options) {
  const result = await searchPaletteBounded({ ...options, buildExactQuery: buildPrecisionTypedQuery });
  return { ...result, evidence: { ...result.evidence, exactScorer: 'palette-precision-typed' } };
}
