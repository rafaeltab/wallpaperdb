// THROWAWAY PROTOTYPES. All ranking happens globally in OpenSearch. These helpers
// move the favorite's five-layer calculations into indexing for offered presets.
import { FEATURE_NAMES } from './corpus-colors.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';
import { cutoffParameters, resolveCutoffTargets } from './methods-cutoff.mjs';
import { metadataFilter } from './query.mjs';
import { FAVORITE_METHOD, FAVORITE_PARAMETERS } from './favorite-scale-corpus.mjs';
import { compileFavoriteScorePlan, scoreFavoriteComponent } from './favorite-optimized-scoring.mjs';

export const FAVORITE_UTILITY_PRESETS = Object.freeze({
  bucketCount: 256, qualityInfluence: Object.freeze([0, .5, 1]),
  cutoffBlendExponent: Object.freeze([0, 1, 3]), targetStepPercent: 5,
});
const COMMON_LIMITATIONS = Object.freeze([
  'Preserves the favorite256 shade-aware strict-hue measurements, anchors and independently weighted five-cutoff formula at offered presets.',
  'Quality influence is restricted to 0, 0.5 or 1; cutoff weighting to 0, 1 or 3; target proportions to multiples of 5%. Other scoring controls retain the saved defaults.',
  'Moving per-target sums before query-time averaging changes float32 rounding order. Formula preservation does not mean bitwise score or near-tie order identity.',
  'Abstract vibes and named families retain the original single named-feature definition. Overlap is marginal; there is no new palette-purity or accent objective.',
  'Every eligible document participates in the OpenSearch ranking, including zero-score documents. There is no candidate retrieval or application reranking.',
]);
export const FAVORITE_UTILITY_METHODS = Object.freeze([
  { id: 'favorite-utility-numeric', encoding: 'numeric', label: 'Favorite256: precomputed float utility', approximate: false, objectiveApproximation: false,
    description: 'Precompute each color’s complete five-cutoff score; query-time native functions read one float per requested color.',
    precision: 'Float32 target utilities and scores; same mathematical formula at supported presets, with changed floating-point grouping.' },
  { id: 'favorite-utility-rank8', encoding: 'rank8', label: 'Favorite256: indexed utility, 8-bit', approximate: false, objectiveApproximation: true,
    description: 'Round each complete target utility to 0..255 and use a positive linear rank feature; quantization changes close rankings.',
    precision: 'Maximum absolute target utility rounding error 1/510, before query float32 arithmetic. Positive integers 1..255 are exactly representable in Lucene rank features.' },
  { id: 'favorite-utility-rank16', encoding: 'rank16', label: 'Favorite256: indexed utility, split 16-bit', approximate: false, objectiveApproximation: true,
    description: 'Round each utility to 0..65535 and split it into two exactly representable base256 rank features; two terms reconstruct its value.',
    precision: 'Maximum absolute target utility rounding error 1/131070, before query float32 arithmetic. Both positive base256 digits are exactly representable.' },
  { id: 'favorite-utility-rankfloat', encoding: 'rankfloat', label: 'Favorite256: indexed utility, native precision', approximate: false, objectiveApproximation: true,
    description: 'Store the complete positive target utility directly as a rank feature, retaining Lucene’s top nine significant bits.',
    precision: 'Native rank-feature precision truncates float32 values to nine significant bits, with less than 0.4% relative loss for normal positive floats.' },
].map(method => Object.freeze({ ...method, family: 'favorite-utilities', representation: 'favorite256-precomputed-utilities',
  searchKind: 'favorite-utilities', retrieval: 'Exact global ranking for the stored utility objective', objectivePrecision: method.precision,
  limitations: Object.freeze([...COMMON_LIMITATIONS, method.precision]) })));

export const FAVORITE_UTILITY_DEFINITION = Object.freeze({
  version: 2, snapshot: 'strict-hue-favorite-001', presets: FAVORITE_UTILITY_PRESETS,
  utility: 'Sum the saved favorite’s independently scored cutoff contributions for a single requested color. Average those precomputed color utilities at query time.',
  precision: 'Single-color utility follows native float32 component scoring before storage. Multi-color grouping differs from the original query.',
  zero: 'Zero rank features are omitted; an explicit zero-score match-all clause keeps eligible documents with no positive feature in the global ranking.',
  fieldLayout: 'Rank-feature fields are partitioned by quality influence and cutoff-weight preset to keep each document field below Lucene term-frequency integer overflow. Numeric utilities retain the original object layout.',
  sources: Object.freeze([
    'https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/document/FeatureField.java',
    'https://docs.opensearch.org/latest/mappings/supported-field-types/rank/',
  ]),
});

export function favoriteUtilityMethod(input = 'favorite-utility-numeric') {
  const id = typeof input === 'string' ? input : input?.id;
  const method = FAVORITE_UTILITY_METHODS.find(candidate => candidate.id === id);
  if (!method) throw Error('Unknown favorite utility method: ' + id);
  return method;
}

export function favoriteUtilityParameters(supplied = {}) {
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw Error('Favorite utility parameters must be an object.');
  const parameters = cutoffParameters(FAVORITE_METHOD, { ...FAVORITE_PARAMETERS, bucketCount: 256, ...supplied });
  for (const [key, value] of Object.entries({ ...FAVORITE_PARAMETERS, bucketCount: 256 })) {
    if (['qualityInfluence', 'cutoffBlendExponent', 'namedMode'].includes(key)) continue;
    if (parameters[key] !== value) throw Error(`Favorite utilities require ${key}=${value}.`);
  }
  if (!FAVORITE_UTILITY_PRESETS.qualityInfluence.includes(parameters.qualityInfluence)) throw Error('qualityInfluence must be one of the indexed presets: 0, 0.5, 1.');
  if (!FAVORITE_UTILITY_PRESETS.cutoffBlendExponent.includes(parameters.cutoffBlendExponent)) throw Error('cutoffBlendExponent must be one of the indexed presets: 0, 1, 3.');
  return parameters;
}

function keyFor(target, mode, parameters) {
  const targetKey = target.kind === 'region' ? 'r' + String(target.regionIndex).padStart(4, '0') : 'n_' + target.name;
  const amountKey = mode === 'vibe' ? 'v' : 'p' + String(Math.round(target.amount * 100)).padStart(3, '0');
  return `${targetKey}_${amountKey}_q${String(parameters.qualityInfluence * 100).padStart(3, '0')}_w${parameters.cutoffBlendExponent}`;
}

export function favoriteUtilityRankField(encoding, parameters = {}) {
  if (!['rank8', 'rank16', 'rankfloat'].includes(encoding)) throw Error('Unsupported rank-feature encoding: ' + encoding);
  const quality = parameters.qualityInfluence ?? .5, weight = parameters.cutoffBlendExponent ?? 1;
  if (!FAVORITE_UTILITY_PRESETS.qualityInfluence.includes(quality) || !FAVORITE_UTILITY_PRESETS.cutoffBlendExponent.includes(weight)) throw Error('Rank-feature field requires supported quality and cutoff-weight presets.');
  return `utility_${encoding}_q${String(quality * 100).padStart(3, '0')}_w${weight}`;
}

export function favoriteUtilityEncodingValueCount(document, encoding) {
  if (encoding === 'numeric') return Object.keys(document.utilities ?? {}).length;
  if (!['rank8', 'rank16', 'rankfloat'].includes(encoding)) throw Error('Unsupported rank-feature encoding: ' + encoding);
  return Object.entries(document).reduce((total, [field, value]) => total + (field.startsWith('utility_' + encoding + '_') ? Object.keys(value).length : 0), 0);
}

function rankFieldsForPlan(plan, encodings) {
  return [...new Set(encodings.filter(encoding => encoding !== 'numeric').flatMap(encoding => plan.descriptors.map(descriptor => favoriteUtilityRankField(encoding, descriptor.parameters))))];
}

export function supportsFavoriteUtilities(methodInput, query, options = {}) {
  const method = favoriteUtilityMethod(methodInput);
  try {
    const parameters = favoriteUtilityParameters(options.parameters);
    const resolved = resolveCutoffTargets(FAVORITE_METHOD, query, { ...options, parameters });
    if (resolved.compiled.mode === 'proportions' && resolved.targets.some(target => Math.abs(target.amount * 20 - Math.round(target.amount * 20)) > 1e-9)) {
      return { supported: false, reason: 'Precomputed proportion targets must be multiples of 5%; intermediate amounts are not silently rounded or interpolated.', warnings: method.limitations };
    }
    return { ...resolved, parameters, warnings: [...resolved.warnings, ...method.limitations],
      utilities: resolved.targets.map(target => ({ ...target, key: keyFor(target, resolved.compiled.mode, parameters) })) };
  } catch (error) {
    return { supported: false, reason: error.message, warnings: method.limitations };
  }
}

function descriptorsFor(query, supplied) {
  const supported = supportsFavoriteUtilities('favorite-utility-numeric', query, { parameters: supplied });
  if (!supported.supported) throw Error(supported.reason);
  const plan = compileFavoriteScorePlan({ query, parameters: supported.parameters });
  return supported.utilities.map(target => ({
    key: target.key, kind: target.kind, name: target.name, regionIndex: target.regionIndex,
    mode: supported.compiled.mode, amount: target.amount, parameters: supported.parameters, components: target.components,
    scoreComponents: plan.components.filter(component => component.targetIndex === target.targetIndex)
      .map(component => ({
        coverageField: component.coverageField, qualityField: component.qualityField,
        vibe: component.vibe, weight: Math.fround(component.componentWeight), origin: component.origin,
        areaFactor: component.areaFactor, areaPower: component.areaPower,
        underScale: component.underScale, overScale: component.overScale,
        qualityApplies: component.qualityApplies, qualityRequired: component.qualityRequired,
        qualityKind: component.qualityKind, qualityScale: component.qualityScale,
        qualityPenalty: component.qualityPenalty, qualityInfluence: component.qualityInfluence,
        minimumQuality: component.minimumQuality,
      })),
  }));
}

/** With requests, index only their required utilities; without requests, build a
 * complete anchor/named-feature bank for the selected parameter presets. */
export function createFavoriteUtilityPlan({ requests, presets = [{}] } = {}) {
  const descriptors = new Map();
  const add = descriptor => descriptors.set(descriptor.key, descriptor);
  if (requests !== undefined) {
    if (!Array.isArray(requests) || requests.length === 0) throw Error('A utility projection requires a nonempty requests array.');
    for (const request of requests) for (const descriptor of descriptorsFor(request.query, request.parameters)) add(descriptor);
  } else {
    if (!Array.isArray(presets) || presets.length === 0) throw Error('A full utility plan requires at least one preset.');
    const targets = [...overlapRegionsForCount(256).map(region => ({ color: region.hex })), ...FEATURE_NAMES.map(name => ({ name }))];
    for (const preset of presets) {
      const parameters = favoriteUtilityParameters(preset);
      for (const target of targets) {
        // Full named-family fields are included even when the UI default uses
        // concrete swatches. Their keys are distinct from region utility keys.
        const targetParameters = target.name ? { ...parameters, namedMode: 'named-families' } : parameters;
        for (const descriptor of descriptorsFor({ mode: 'vibe', targets: [target] }, targetParameters)) add(descriptor);
        for (let percent = 0; percent <= 100; percent += 5) {
          // The interpreter requires a positive total requested amount. A dummy
          // target permits the useful zero-amount profile; it is never indexed.
          const query = { mode: 'proportions', targets: [{ ...target, percent }, ...(percent === 0 ? [{ color: '#ff0000', percent: 100 }] : [])] };
          add(descriptorsFor(query, targetParameters)[0]);
        }
      }
    }
  }
  const values = [...descriptors.values()].sort((a, b) => a.key.localeCompare(b.key));
  const measurementFields = [...new Set(values.flatMap(descriptor => descriptor.components.flatMap(component => [component.coverageField, component.qualityField])))].sort();
  return { definition: FAVORITE_UTILITY_DEFINITION, scope: requests ? 'projection' : 'full',
    descriptors: values, measurementFields, utilityCount: values.length };
}

const ENCODINGS = Object.freeze(['numeric', 'rank8', 'rank16', 'rankfloat']);
function validateEncodings(encodings) {
  if (!Array.isArray(encodings) || !encodings.length || new Set(encodings).size !== encodings.length || encodings.some(encoding => !ENCODINGS.includes(encoding))) throw Error('Use distinct supported utility encodings: ' + ENCODINGS.join(', '));
  return encodings;
}
const metadataProperties = Object.freeze({
  id: { type: 'keyword' }, reference_id: { type: 'keyword' }, cohort: { type: 'keyword' },
  partition: { type: 'integer' }, tags: { type: 'keyword' },
});
export function favoriteUtilityMapping(plan, { source = true, shards = 1, encodings = ENCODINGS } = {}) {
  validateEncodings(encodings);
  if (!Number.isInteger(shards) || shards < 1) throw Error('Utility shard count must be a positive integer.');
  const properties = { ...metadataProperties };
  if (encodings.includes('numeric')) properties.utilities = { type: 'object', dynamic: 'strict',
    properties: Object.fromEntries(plan.descriptors.map(descriptor => [descriptor.key, { type: 'float', index: false, doc_values: true }])) };
  for (const field of rankFieldsForPlan(plan, encodings)) properties[field] = { type: 'rank_features', positive_score_impact: true };
  const totalFields = Object.keys(properties).length + (encodings.includes('numeric') ? plan.descriptors.length : 0);
  return { settings: { number_of_shards: shards, number_of_replicas: 0, refresh_interval: '-1', 'index.mapping.total_fields.limit': totalFields + 20 },
    mappings: { dynamic: 'strict', _source: { enabled: source }, properties } };
}

const bits = new DataView(new ArrayBuffer(4));
export function quantizeRankFeature(value) {
  if (!Number.isFinite(value) || value < 0) throw Error('Rank-feature values must be finite and nonnegative.');
  if (value === 0) return 0;
  const rounded = Math.fround(value);
  if (!Number.isFinite(rounded) || rounded < 2 ** -126) throw Error('Positive rank-feature values must be normal float32 values.');
  bits.setFloat32(0, rounded);
  bits.setUint32(0, (bits.getUint32(0) >>> 15) << 15);
  return bits.getFloat32(0);
}

function descriptorUtility(document, descriptor) {
  const sum = descriptor.scoreComponents.reduce((total, component) => total + scoreFavoriteComponent(document, component), 0);
  return Math.fround(Math.max(0, Math.min(1, sum)));
}
function validateMeasurements(document, fields) {
  for (const field of fields) {
    const value = document[field], coverage = field.startsWith('cov_');
    if (!Number.isFinite(value) || value < 0 || value > (coverage ? 10000 : 1) || (coverage && !Number.isInteger(value))) throw Error('Missing or invalid favorite measurement: ' + field);
  }
}
export function toFavoriteUtilityDocument(document, plan, { encodings = ENCODINGS } = {}) {
  validateEncodings(encodings);
  if (typeof document.id !== 'string' || !document.id) throw Error('A measured wallpaper ID is required.');
  validateMeasurements(document, plan.measurementFields);
  const result = { id: document.id, reference_id: document.reference_id ?? document.id, cohort: document.cohort ?? 'real',
    partition: document.partition ?? 0, tags: document.tags ?? [] };
  if (encodings.includes('numeric')) result.utilities = {};
  for (const field of rankFieldsForPlan(plan, encodings)) result[field] = {};
  for (const descriptor of plan.descriptors) {
    const value = descriptorUtility(document, descriptor);
    const rank8 = result[favoriteUtilityRankField('rank8', descriptor.parameters)];
    const rank16 = result[favoriteUtilityRankField('rank16', descriptor.parameters)];
    const rankfloat = result[favoriteUtilityRankField('rankfloat', descriptor.parameters)];
    if (result.utilities) result.utilities[descriptor.key] = value;
    if (rank8) { const integer = Math.round(value * 255); if (integer) rank8[descriptor.key] = integer; }
    if (rank16) {
      const integer = Math.round(value * 65535), high = integer >>> 8, low = integer & 255;
      if (high) rank16[descriptor.key + '_hi'] = high;
      if (low) rank16[descriptor.key + '_lo'] = low;
    }
    // Store the original positive float; Lucene performs the truncation itself.
    if (rankfloat && value > 0) rankfloat[descriptor.key] = value;
  }
  return result;
}

export function buildFavoriteUtilityQuery({ method: methodInput = 'favorite-utility-numeric', query, parameters = {},
  limit = 20, eligibleIds, excludedIds, filter } = {}) {
  const method = favoriteUtilityMethod(methodInput);
  const resolved = supportsFavoriteUtilities(method, query, { parameters, eligibleIds, excludedIds });
  if (!resolved.supported) throw Error(resolved.reason);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw Error('Utility query limit must be 1..10000.');
  const terms = [], denominator = resolved.targets.length;
  const rankField = method.encoding === 'numeric' ? null : favoriteUtilityRankField(method.encoding, resolved.parameters);
  const addFeature = (field, boost) => terms.push({ rank_feature: { field, linear: {}, boost } });
  for (const target of resolved.utilities) {
    if (method.encoding === 'numeric') terms.push({ function_score: { query: { match_all: {} },
      field_value_factor: { field: 'utilities.' + target.key, factor: 1 / denominator, modifier: 'none', missing: 0 }, boost_mode: 'replace' } });
    if (method.encoding === 'rank8') addFeature(rankField + '.' + target.key, 1 / (255 * denominator));
    if (method.encoding === 'rank16') {
      addFeature(rankField + '.' + target.key + '_hi', 256 / (65535 * denominator));
      addFeature(rankField + '.' + target.key + '_lo', 1 / (65535 * denominator));
    }
    if (method.encoding === 'rankfloat') addFeature(rankField + '.' + target.key, 1 / denominator);
  }
  return { size: limit, _source: false, track_total_hits: false,
    query: { bool: { filter: [metadataFilter({ eligibleIds, excludedIds, filter, compiled: resolved.compiled })],
      must: [{ constant_score: { filter: { match_all: {} }, boost: 0 } }], should: terms, minimum_should_match: 0 } },
    sort: [{ _score: 'desc' }, { id: 'asc' }] };
}

/** Correctness oracle only. Search must use the OpenSearch query above. The
 * caller may compare this to the original scorer to measure rounding changes. */
export function favoriteUtilityReference(document, query, { method: methodInput = 'favorite-utility-numeric', parameters = {} } = {}) {
  const method = favoriteUtilityMethod(methodInput), descriptors = descriptorsFor(query, parameters);
  validateMeasurements(document, [...new Set(descriptors.flatMap(d => d.components.flatMap(c => [c.coverageField, c.qualityField])))]);
  const n = descriptors.length;
  let score = 0;
  for (const descriptor of descriptors) {
    const value = descriptorUtility(document, descriptor);
    if (method.encoding === 'numeric') score += Math.fround(value * Math.fround(1 / n));
    if (method.encoding === 'rank8') score += Math.fround(Math.round(value * 255) * Math.fround(1 / (255 * n)));
    if (method.encoding === 'rank16') {
      const integer = Math.round(value * 65535);
      score += Math.fround((integer >>> 8) * Math.fround(256 / (65535 * n)));
      score += Math.fround((integer & 255) * Math.fround(1 / (65535 * n)));
    }
    if (method.encoding === 'rankfloat') score += Math.fround(quantizeRankFeature(value) * Math.fround(1 / n));
  }
  return Math.fround(score);
}
