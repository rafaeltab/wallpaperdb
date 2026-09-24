// Direct palette colors: no RGB4096 lookup or additional range-boundary quantization.
import { interpretQuery, metadataFilter } from './query.mjs';

export const DIRECT_PALETTE_METHODS = Object.freeze([
  { id: 'palette-direct-balanced', label: 'Direct Palette32 balanced area and color', family: 'direct-palette', representation: 'palette32-direct', approximate: false, searchKind: 'direct-palette',
    limitations: ['Original 24-bit palette centroids are evaluated directly in Painless; the 32-color palette remains a lossy image representation.', 'Named regions and scoring weights are provisional; overlapping portions use marginal area.', 'Purity penalties apply only to complete palettes; partial queries use target error.'] },
  { id: 'palette-direct-precision', label: 'Direct Palette32 with shade-first picked colors', family: 'direct-palette', representation: 'palette32-direct', approximate: false, searchKind: 'direct-palette', shadeFirst: true,
    limitations: ['Picked-color vibe requests prioritize conditional shade quality after 5% matching area.', 'The 5% support threshold is an explicit experimental heuristic; no model is trained.', 'Palette reduction still loses within-cluster colors, though range checks no longer snap centroids to coarse bins.'] },
]);

export const DIRECT_MEMBERSHIP = `
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
  double chroma = Math.sqrt(labA * labA + labB * labB);
  double high = Math.max(r, Math.max(g, b));
  double low = Math.min(r, Math.min(g, b));
  double delta = high - low;
  double hsvS = high == 0 ? 0 : delta / high;
  double hslL = (high + low) / 2.0;
  double hslS = delta < 1e-8 ? 0 : delta / (1.0 - Math.abs(2.0 * hslL - 1.0));
  double hue = 0.0;
  if (delta > 0) {
    hue = high == r ? (g - b) / delta : high == g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = ((hue * 60.0) % 360.0 + 360.0) % 360.0;
  }
  double inUnion = 0.0;
  for (int j = 0; j < count; j++) {
    Map target = params.targets[j];
    String name = target.name;
    List ranges = target.ranges;
    boolean inside = false;
    double quality = 0.0;
    if (ranges.size() > 0) {
      double distance = 0.0;
      for (int ri = 0; ri < ranges.size(); ri++) {
        Map range = ranges[ri];
        int space = range.space;
        if (space == 0) {
          double dl = labL - target.lab[0]; double da = labA - target.lab[1]; double db = labB - target.lab[2];
          double d = Math.sqrt(dl * dl + da * da + db * db);
          double radius = range.widths[0];
          distance = Math.max(distance, radius > 0 ? d / radius : d < 1e-8 ? 0.0 : 1e30);
        } else {
          for (int channel = 0; channel < 3; channel++) {
            double d;
            if (space == 1) {
              double value = channel == 0 ? r : channel == 1 ? g : b;
              d = Math.abs(value - target.rgb[channel]);
            } else if (channel == 0) {
              if (range.widths[0] == 1) continue;
              if (delta < 1e-8) d = 1.0;
              else { d = Math.abs(hue / 360.0 - target.hue); d = Math.min(d, 1.0 - d) * 2.0; }
            } else {
              double value = space == 2 ? (channel == 1 ? hsvS : high) : (channel == 1 ? hslS : hslL);
              double anchor = space == 2 ? target.hsv[channel - 1] : target.hsl[channel - 1];
              d = Math.abs(value - anchor);
            }
            double width = range.widths[channel];
            distance = Math.max(distance, width > 0 ? d / width : d < 1e-8 ? 0.0 : 1e30);
          }
        }
      }
      inside = distance <= 1.0 + 1e-9;
      quality = inside ? 1.0 - (1.0 - target.edgeWeight) * Math.min(1.0, distance) : 0.0;
    } else {
      double core = 0.0;
      if (target.hueWidth > 0) {
        double hueDistance = Math.abs(((hue - target.hueCenter + 540.0) % 360.0) - 180.0);
        inside = hueDistance <= target.hueWidth && hsvS >= 0.18 && high >= 0.09 && chroma >= 0.018;
        if (name == 'pink') inside = inside && labL >= 0.56;
        if (name == 'brown') inside = inside && labL >= 0.22 && labL <= 0.65;
        double palePenalty = name == 'red' ? 1.0 - Math.max(0.0, Math.min(1.0, (labL - 0.72) / 0.24)) * 0.65 : 1.0;
        core = (1.0 - hueDistance / target.hueWidth) * Math.sqrt(hsvS) * Math.sqrt(high) * palePenalty;
      } else if (name == 'strict_grayscale') { inside = chroma <= 0.005; core = 1.0 - chroma / 0.005; }
      else if (name == 'grayscale') { inside = chroma <= 0.035; core = 1.0 - chroma / 0.035; }
      else if (name == 'near_neutral') { inside = chroma <= 0.065; core = 1.0 - chroma / 0.065; }
      else if (name == 'black') { inside = labL <= 0.25; core = 1.0 - labL / 0.25; }
      else if (name == 'gray') { inside = chroma <= 0.045 && labL >= 0.2 && labL <= 0.88; core = (1.0 - chroma / 0.045) * (1.0 - Math.abs(labL - 0.54) / 0.34); }
      else if (name == 'white') { inside = chroma <= 0.055 && labL >= 0.86; core = (1.0 - chroma / 0.055) * (labL - 0.86) / 0.14; }
      else if (name == 'dark') { inside = labL <= 0.5; core = 1.0 - labL / 0.5; }
      else if (name == 'light') { inside = labL >= 0.72; core = (labL - 0.72) / 0.28; }
      else if (name == 'bright') { inside = high >= 0.72 && labL >= 0.55; core = (high - 0.72) / 0.28; }
      else if (name == 'vivid') { inside = hsvS >= 0.55 && high >= 0.5; core = (hsvS - 0.55) / 0.45 * (high - 0.5) / 0.5; }
      else if (name == 'muted') { inside = hsvS <= 0.4 && chroma <= 0.085; core = 1.0 - chroma / 0.085; }
      quality = inside ? 0.5 + 0.5 * Math.max(0.0, Math.min(1.0, core)) : 0.0;
    }
    if (inside) { areas[j] += mass; masses[j] += mass * quality; inUnion = 1.0; }
  }
  union += mass * inUnion;
`;

export const DIRECT_PALETTE_SCRIPT = `
int count = params.targets.size();
double[] areas = new double[count]; double[] masses = new double[count];
double union = 0.0;
double total = doc['palette_total'].value;
for (int i = 0; i < doc['palette32_packed'].size(); i++) {
  long packed = doc['palette32_packed'].get(i);
  long rgb = packed / 65536L;
  double mass = (packed % 65536L) / total;
  ${DIRECT_MEMBERSHIP}
}
if (params.diagnostic == 'area') return areas[0];
if (params.diagnostic == 'quality') return areas[0] > 0 ? masses[0] / areas[0] : 0.0;
if (params.special == 'gray_red_accents') {
  double red = areas[1]; double quality = red > 0 ? masses[1] / red : 0.0;
  double accent = Math.min(1.0, red / 0.12) * Math.max(0.0, 1.0 - Math.max(0.0, red - 0.35) / 0.65);
  return Math.max(0.0, areas[0] * accent * (0.4 + 0.6 * quality) - params.outsidePenalty * Math.max(0.0, 1.0 - union));
}
if (params.special == 'dark_bright_accents') {
  double accent = Math.min(1.0, areas[1] / 0.03) * Math.max(0.0, 1.0 - Math.max(0.0, areas[1] - 0.15) / 0.85);
  return areas[0] * accent;
}
if (params.mode == 'vibe') {
  double score = 0.0;
  for (int j = 0; j < count; j++) {
    double quality = areas[j] > 0 ? masses[j] / areas[j] : 0.0;
    double support = params.shadeFirst && params.targets[j].name == '' ? Math.min(1.0, areas[j] / params.minimumSupport) : Math.pow(areas[j], params.areaPower);
    score += support * quality;
  }
  return score / count;
}
double error = 0.0; double qualityError = 0.0;
for (int j = 0; j < count; j++) {
  double delta = areas[j] - params.targets[j].amount;
  error += Math.abs(delta) * (delta > 0 ? params.excessPenalty : 1.0);
  double quality = areas[j] > 0 ? masses[j] / areas[j] : 0.0;
  qualityError += Math.min(areas[j], params.targets[j].amount) * (1.0 - quality);
}
error = error / count + params.qualityPenalty * qualityError;
if (params.remainder < 1e-9) error += params.outsidePenalty * Math.max(0.0, 1.0 - union);
return 1.0 / (1.0 + error);
`;

const HUES = { red: [4, 46], orange: [29, 25], yellow: [58, 24], green: [127, 61], teal: [172, 29], cyan: [191, 32], blue: [234, 47], purple: [282, 38], pink: [334, 44], brown: [29, 28] };
function targetParameters(target) {
  const rgb = target.rgb ?? [0, 0, 0];
  const [r, g, b] = rgb, high = Math.max(...rgb), low = Math.min(...rgb), delta = high - low;
  const hue = delta < 1e-8 ? null : (((high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6) % 1 + 1) % 1;
  const lightness = (high + low) / 2;
  const ranges = target.ranges.map(range => {
    if (['hsl', 'hsv'].includes(range.space) && range.h < 1 && hue == null) throw new Error('Achromatic anchors require hue distance 100%.');
    const keys = { oklab: ['distance'], rgb: ['r', 'g', 'b'], hsv: ['h', 's', 'v'], hsl: ['h', 's', 'l'] }[range.space];
    return { space: ['oklab', 'rgb', 'hsv', 'hsl'].indexOf(range.space), widths: keys.map(k => range[k]) };
  });
  return { name: target.name ?? '', amount: target.amount, rgb, lab: target.lab ?? [0, 0, 0], hue: hue ?? 0,
    hsv: [high ? delta / high : 0, high], hsl: [delta < 1e-8 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)), lightness],
    ranges, edgeWeight: target.edgeWeight, hueCenter: HUES[target.name]?.[0] ?? 0, hueWidth: HUES[target.name]?.[1] ?? 0 };
}

export function supportsDirectPalette(query) {
  const compiled = interpretQuery(query);
  if (!compiled.supported) return compiled;
  if (compiled.targets.some(t => ['monochromatic', 'rainbow'].includes(t.name))) return { supported: false, reason: 'Direct palette region matching has no global hue-diversity objective.' };
  try { compiled.targets.map(targetParameters); } catch (error) { return { supported: false, reason: error.message }; }
  return { supported: true, compiled, warnings: ['Palette32 is a lossy summary, but membership uses original centroid RGB directly.'] };
}

export function buildDirectPaletteQuery({ method = 'palette-direct-balanced', query, limit = 20, eligibleIds, excludedIds, filter, parameters = {} }) {
  const id = typeof method === 'string' ? method : method.id;
  const definition = DIRECT_PALETTE_METHODS.find(m => m.id === id);
  if (!definition) throw new Error(`Unknown direct palette method: ${id}`);
  const check = supportsDirectPalette(query);
  if (!check.supported) throw new Error(check.reason);
  const compiled = check.compiled;
  const params = { targets: compiled.targets.map(targetParameters), mode: compiled.mode, special: compiled.special ?? '', remainder: compiled.remainder,
    shadeFirst: definition.shadeFirst ?? false, minimumSupport: parameters.minimumSupport ?? 0.05, areaPower: parameters.areaPower ?? 0.65,
    qualityPenalty: parameters.qualityPenalty ?? 0.15, outsidePenalty: parameters.outsidePenalty ?? 6, excessPenalty: parameters.excessPenalty ?? 1.3, diagnostic: '' };
  if (!(params.minimumSupport > 0 && params.minimumSupport <= 1) || !(params.areaPower > 0) || [params.qualityPenalty, params.outsidePenalty, params.excessPenalty].some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid direct-palette scoring parameters.');
  return { size: limit, _source: false, track_total_hits: false, sort: [{ _score: 'desc' }, { id: 'asc' }], query: { script_score: {
    query: metadataFilter({ eligibleIds, excludedIds, filter, compiled }), script: { lang: 'painless', source: DIRECT_PALETTE_SCRIPT, params },
  } } };
}
