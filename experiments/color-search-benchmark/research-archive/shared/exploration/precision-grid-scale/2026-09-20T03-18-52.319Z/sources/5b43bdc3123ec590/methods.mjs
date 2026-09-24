// Service-backed experimental methods. JavaScript compiles queries, never ranks documents.
import { buildQueryVector } from '../evaluation/loop/adapters.mjs';
import { FEATURE_NAMES, RGB4096_CENTERS, rgbToLab } from './corpus-colors.mjs';
import { interpretQuery, membership, metadataFilter, targetCellWeights } from './query.mjs';
export { interpretQuery } from './query.mjs';

const definition = (id, label, family, representation, options = {}) => ({ id, label, family, representation, approximate: false, limitations: [], ...options });
export const METHODS = Object.freeze([
  definition('hsv-cosine-ann', 'HSV64 cosine ANN control', 'vector', 'hsv64', { field: 'hsv_cosine', metric: 'cosinesimil', approximate: true, vector: true, limitations: ['Approximate nearest neighbors; named colors are reference swatches.', 'Percentage weights define a normalized distribution, not image-area targets.'] }),
  definition('hsv-l2-raw-ann', 'HSV64 raw L2 ANN control', 'vector', 'hsv64', { field: 'hsv_l2', metric: 'l2', approximate: true, vector: true, raw: true, limitations: ['Historical unnormalized Gaussian query against unit-sum documents.', 'Partial remainder and target-area semantics are not implemented.'] }),
  definition('hsv-l2-unit-ann', 'HSV64 unit-sum L2 ANN', 'vector', 'hsv64', { field: 'hsv_l2', metric: 'l2', approximate: true, vector: true }),
  definition('hsv-hellinger-ann', 'HSV64 Hellinger ANN', 'vector', 'hsv64', { field: 'hsv_sqrt', metric: 'l2', approximate: true, vector: true, sqrt: true }),
  definition('rgb-hellinger-ann', 'RGB512 perceptual query + Hellinger ANN', 'vector', 'rgb512', { field: 'rgb_sqrt', metric: 'l2', approximate: true, vector: true, sqrt: true }),
  definition('rgb-cosine-ann', 'RGB512 perceptual query + cosine ANN', 'vector', 'rgb512', { field: 'rgb_cosine', metric: 'cosinesimil', approximate: true, vector: true }),
  definition('hsv-cosine-exact', 'HSV64 exhaustive cosine reference', 'vector-reference', 'hsv64', { field: 'hsv_cosine', metric: 'cosinesimil', vector: true, exactVector: true, limitations: ['Exhaustive service scoring is a recall reference; scales with matching documents.'] }),
  definition('rgb-kernel-exact', 'Fine RGB histogram perceptual kernel', 'kernel', 'rgb4096', { scoring: 'kernel', limitations: ['Scores matching color mass; proportional targets do not receive target-area errors.'] }),
  definition('palette-area-exact', 'Palette32 target area', 'area', 'palette32', { scoring: 'area', limitations: ['Palette centroids can erase small regions and cross category boundaries; centroids use RGB4096 query lookup.'] }),
  definition('histogram-area-exact', 'Fine histogram target area', 'area', 'rgb4096', { scoring: 'area' }),
  definition('histogram-composition-exact', 'Fine histogram area + quality + palette purity', 'composition', 'rgb4096', { scoring: 'composition', limitations: ['Area regions overlap; this is marginal matching, not exclusive pixel allocation.', 'Unrequested-color penalty is a provisional hand-authored preference.'] }),
  definition('native-area-linear', 'Indexed family areas, linear target error', 'native', 'named-features', { native: 'linear' }),
  definition('native-area-gauss', 'Indexed family areas, Gaussian target error', 'native', 'named-features', { native: 'gauss' }),
  definition('native-area-postings', 'Indexed coverage bucket postings', 'postings', 'named-features', { native: 'postings', limitations: ['Areas quantized to 1% buckets; additive score can use indexed postings.'] }),
  definition('feature-composition-exact', 'Named feature area + quality + palette purity', 'composition', 'named-features', { scoring: 'composition', scalar: true, limitations: ['Marginal family overlap makes outside-color estimate approximate; fixed named categories only.'] }),
  definition('rgb-cdf-wasserstein', 'RGB marginal distribution Wasserstein', 'distribution', 'rgb-cdf48', { limitations: ['Independent RGB channel distributions discard joint hue correlations.', 'Targets define full distributions; unrestricted remainders are not modeled.'] }),
]);

export function getMethod(method) {
  if (method && typeof method === 'object' && METHODS.some(m => m.id === method.id)) return { ...METHODS.find(m => m.id === method.id), ...method };
  const found = METHODS.find(m => m.id === method);
  if (!found) throw new Error(`Unknown color method: ${method}`);
  return found;
}

export function supports(methodInput, query, options = {}) {
  const method = getMethod(methodInput);
  const compiled = interpretQuery(query);
  if (!compiled.supported) return compiled;
  const warnings = [...method.limitations];
  if (method.scoring === 'area' && !compiled.special) warnings.push('This area-only scorer ignores color quality and edge falloff; every color inside the region counts equally.');
  const global = compiled.targets.some(t => ['monochromatic', 'rainbow'].includes(t.name));
  if (global) warnings.push('Monochromatic and rainbow values measure global hue distribution strength; they are not literal image-area percentages.');
  if (global && method.representation !== 'named-features') return { supported: false, reason: 'This representation has no global hue-diversity feature.', warnings };
  if ((method.native || method.scalar) && compiled.customRanges) return { supported: false, reason: 'Indexed named-family features cannot answer arbitrary picked colors or ranges.', warnings };
  if ((method.native || method.scalar) && compiled.targets.some(t => !t.name)) return { supported: false, reason: 'This method requires named color/vibe features.', warnings };
  if (method.vector && (compiled.special || compiled.targets.some(t => ['dark', 'light', 'bright', 'vivid', 'muted', 'grayscale', 'strict_grayscale', 'near_neutral'].includes(t.name)))) return { supported: false, reason: 'The swatch-vector control has no explicit grayscale, lighting, or accent model.', warnings };
  if (method.vector && compiled.explicitRanges) return { supported: false, reason: 'This swatch-vector prototype has a fixed Gaussian query shape; it does not implement explicit range edges or RGB/HSV/HSL channel controls.', warnings };
  if (compiled.subject && !options.eligibleIds) warnings.push('Subject is a mandatory indexed tag filter; imported images without that tag cannot match.');
  if ((method.vector || method.family === 'distribution' || method.scoring === 'kernel') && compiled.mode === 'proportions') warnings.push('This comparison treats target amounts as distribution weights, not whole-image target-area errors; unspecified remainder is not free.');
  if (compiled.targets.length > 1 && method.representation !== 'named-features') warnings.push('Overlapping target regions use marginal areas; a pixel can satisfy more than one requested global property.');
  return { supported: true, warnings, compiled };
}

const unitSum = values => { const total = values.reduce((s, v) => s + v, 0); return values.map(v => total ? v / total : 0); };
const RGB512_CENTERS = Array.from({ length: 512 }, (_, i) => [((i >> 6) * 32 + 15.5) / 255, (((i >> 3) & 7) * 32 + 15.5) / 255, ((i & 7) * 32 + 15.5) / 255]);
const RGB512_LABS = RGB512_CENTERS.map(rgbToLab);
const cache = new Map();
function cached(key, build) {
  if (cache.has(key)) return cache.get(key);
  const value = build(); cache.set(key, value);
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  return value;
}

function vectorFor(method, compiled, parameters = {}) {
  let values;
  if (method.representation === 'hsv64') {
    values = buildQueryVector(compiled.targets.filter(t => t.amount > 0).map(t => ({ color: t.color, amount: t.amount, spread: parameters.spread ?? 0.5 })), { queryNormalization: method.raw ? 'none' : 'unit-sum', ...(parameters.sigma == null ? {} : { sigma: parameters.sigma }) });
  } else {
    const sigma = parameters.sigma ?? (compiled.customRanges ? 0.08 : 0.13);
    values = RGB512_LABS.map(lab => compiled.targets.reduce((sum, t) => sum + t.amount * Math.exp(-lab.reduce((d, x, i) => d + (x - t.lab[i]) ** 2, 0) / (2 * sigma * sigma)), 0));
    values = unitSum(values);
  }
  return method.sqrt ? values.map(Math.sqrt) : values;
}

const GATHER_HISTOGRAM = `
double[] areas = new double[params.targets.length];
double[] masses = new double[params.targets.length];
double union = 0.0;
double total = doc[params.totalField].value;
for (int i = 0; i < doc[params.histField].size(); i++) {
  long packed = doc[params.histField].get(i);
  long encoded = packed / 65536L;
  int cell;
  if (params.palette) cell = (int)(((encoded >> 20) << 8) + (((encoded >> 12) & 15) << 4) + ((encoded >> 4) & 15));
  else cell = (int)encoded;
  double mass = (packed % 65536L) / total;
  double inUnion = 0.0;
  for (int j = 0; j < params.targets.length; j++) {
    double inside = params.weights[j][cell];
    areas[j] += mass * inside;
    masses[j] += mass * params.qualities[j][cell];
    inUnion = Math.max(inUnion, inside);
  }
  union += mass * inUnion;
}
`;
const GATHER_FEATURES = `
double[] areas = new double[params.targets.length];
double[] masses = new double[params.targets.length];
double union = 0.0;
for (int j = 0; j < params.targets.length; j++) {
  areas[j] = doc[params.areaFields[j]].value / 10000.0;
  masses[j] = areas[j] * doc[params.qualityFields[j]].value;
  union += areas[j];
}
union = Math.min(1.0, union);
`;
const SCORE = `
if (params.special == 'gray_red_accents') {
  double neutral = areas[0]; double red = areas[1];
  double redQuality = red > 0 ? masses[1] / red : 0.0;
  double accent = Math.min(1.0, red / 0.12) * Math.max(0.0, 1.0 - Math.max(0.0, red - 0.35) / 0.65);
  return Math.max(0.0, neutral * accent * (0.4 + 0.6 * redQuality) - params.outsidePenalty * Math.max(0.0, 1.0 - union));
}
if (params.special == 'dark_bright_accents') {
  double bright = areas[1];
  double accent = Math.min(1.0, bright / 0.03) * Math.max(0.0, 1.0 - Math.max(0.0, bright - 0.15) / 0.85);
  return Math.max(0.0, areas[0] * accent);
}
if (params.mode == 'vibe' || params.scoring == 'kernel') {
  double score = 0.0;
  for (int j = 0; j < areas.length; j++) {
    double quality = areas[j] > 0 ? masses[j] / areas[j] : 0.0;
    score += Math.pow(areas[j], params.areaPower) * (params.scoring == 'area' ? 1.0 : quality) * params.targets[j];
  }
  return score / params.targetSum;
}
double error = 0.0; double qualityError = 0.0;
for (int j = 0; j < areas.length; j++) {
  double delta = areas[j] - params.targets[j];
  error += Math.abs(delta) * (delta > 0 ? params.excessPenalty : 1.0);
  double quality = areas[j] > 0 ? masses[j] / areas[j] : 0.0;
  qualityError += Math.min(areas[j], params.targets[j]) * (1.0 - quality);
}
error /= areas.length;
if (params.scoring == 'composition') {
  error += params.qualityPenalty * qualityError;
  error += params.outsidePenalty * Math.max(0.0, 1.0 - union - params.remainder);
}
return 1.0 / (1.0 + error);
`;
export const HISTOGRAM_SCRIPT = GATHER_HISTOGRAM + SCORE;
export const FEATURE_SCRIPT = GATHER_FEATURES + SCORE;
export const CDF_SCRIPT = `double error = 0; for (int i=0; i<doc['rgb_cdf48_packed'].size(); i++) { long packed=doc['rgb_cdf48_packed'].get(i); int index=(int)(packed/65536L); double value=(packed%65536L)/16384.0; error += Math.abs(value-params.cdf[index]); } return 1.0/(1.0+error/48.0);`;

function scriptParams(method, compiled, parameters) {
  const targets = compiled.targets.map(t => compiled.mode === 'proportions' ? t.amount : 1);
  const result = {
    mode: compiled.mode, special: compiled.special ?? '', scoring: method.scoring,
    targets, targetSum: targets.reduce((s, x) => s + x, 0) || 1,
    remainder: compiled.remainder, areaPower: parameters.areaPower ?? 0.65,
    qualityPenalty: parameters.qualityPenalty ?? 0.35, outsidePenalty: parameters.outsidePenalty ?? 6,
    excessPenalty: parameters.excessPenalty ?? 1,
  };
  if (method.scalar) return { ...result, areaFields: compiled.targets.map(t => `cov_${t.name}`), qualityFields: compiled.targets.map(t => `quality_${t.name}`) };
  const cellWeights = cached(JSON.stringify(compiled.targets), () => targetCellWeights(compiled, RGB4096_CENTERS));
  return { ...result, weights: cellWeights.map(w => w.area), qualities: cellWeights.map(w => w.quality), histField: method.representation === 'palette32' ? 'palette32_packed' : 'rgb4096', totalField: method.representation === 'palette32' ? 'palette_total' : 'pixel_total', palette: method.representation === 'palette32' };
}

function nativeQuery(method, compiled, filter) {
  if (compiled.special) {
    const scalar = { ...method, scalar: true, scoring: 'composition' };
    return { script_score: { query: filter, script: { lang: 'painless', source: FEATURE_SCRIPT, params: scriptParams(scalar, compiled, {}) } } };
  }
  if (method.native === 'postings') {
    const clauses = compiled.targets.flatMap(t => Array.from({ length: 101 }, (_, bucket) => ({
      constant_score: {
        filter: { term: { coverage_tokens: `${t.name}:${bucket}` } },
        boost: Math.max(0.001, 100 - Math.abs(bucket - (compiled.mode === 'vibe' ? 100 : Math.round(t.amount * 100)))),
      },
    })));
    return { bool: { filter: [filter], should: clauses, minimum_should_match: 1 } };
  }
  return { function_score: { query: filter, functions: compiled.targets.map(t => ({ [method.native]: { [`cov_${t.name}`]: { origin: compiled.mode === 'vibe' ? 10000 : Math.round(t.amount * 10000), scale: method.native === 'linear' ? 5000 : 2000, decay: 0.5, offset: 0 } }, weight: 1 })), score_mode: 'avg', boost_mode: 'replace' } };
}

function cdfFor(compiled) {
  const weights = targetCellWeights(compiled, RGB4096_CENTERS);
  const distribution = new Array(4096).fill(0);
  for (let j = 0; j < weights.length; j++) {
    const normalized = unitSum(weights[j].quality);
    normalized.forEach((weight, i) => { distribution[i] += weight * compiled.targets[j].amount; });
  }
  const normalized = unitSum(distribution);
  const cdf = new Array(48).fill(0);
  normalized.forEach((mass, cell) => { const coordinates = [cell >> 8, (cell >> 4) & 15, cell & 15]; coordinates.forEach((coordinate, channel) => { for (let bin = coordinate; bin < 16; bin++) cdf[channel * 16 + bin] += mass; }); });
  return cdf;
}

/** Returns a complete OpenSearch search body. Every eligible document is ranked by the service. */
export function buildQuery({ method: input, query, limit = 20, eligibleIds, excludedIds, filter, parameters = {} }) {
  const method = getMethod(input), check = supports(method, query, { eligibleIds, excludedIds });
  if (!check.supported) throw new Error(check.reason);
  const compiled = check.compiled;
  const filtered = metadataFilter({ eligibleIds, excludedIds, filter, compiled });
  let search;
  if (method.vector) {
    const vector = vectorFor(method, compiled, parameters);
    if (method.exactVector) search = { script_score: { query: filtered, script: { lang: 'knn', source: 'knn_score', params: { field: method.field, query_value: vector, space_type: method.metric } } } };
    else search = { knn: { [method.field]: { vector, k: Math.min(10000, Math.max(limit, parameters.k ?? limit)), filter: filtered } } };
  } else if (method.native) search = nativeQuery(method, compiled, filtered);
  else if (method.representation === 'rgb-cdf48') search = { script_score: { query: filtered, script: { lang: 'painless', source: CDF_SCRIPT, params: { cdf: cached(`cdf:${JSON.stringify(compiled)}`, () => cdfFor(compiled)) } } } };
  else search = { script_score: { query: filtered, script: { lang: 'painless', source: method.scalar ? FEATURE_SCRIPT : HISTOGRAM_SCRIPT, params: scriptParams(method, compiled, parameters) } } };
  return { size: limit, _source: false, track_total_hits: false, query: search, sort: [{ _score: 'desc' }, { id: 'asc' }] };
}

export const VECTOR_FIELDS = Object.freeze({ hsv_cosine: { dimension: 64, space_type: 'cosinesimil', source: 'hsv64' }, hsv_l2: { dimension: 64, space_type: 'l2', source: 'hsv64' }, hsv_sqrt: { dimension: 64, space_type: 'l2', source: 'hsv64_sqrt' }, rgb_cosine: { dimension: 512, space_type: 'cosinesimil', source: 'rgb512' }, rgb_sqrt: { dimension: 512, space_type: 'l2', source: 'rgb512_sqrt' } });
export const SCALAR_FIELDS = Object.freeze(Object.fromEntries(FEATURE_NAMES.flatMap(name => [[`cov_${name}`, { type: 'integer' }], [`quality_${name}`, { type: 'float' }]])));
