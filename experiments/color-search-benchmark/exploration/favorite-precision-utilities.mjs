// THROWAWAY refinement: retain the favorite's complete precomputed utility,
// encoding it in two/three exactly representable base512 rank-feature limbs.
// All user filtering and ranking happen globally inside OpenSearch.
import {
  FAVORITE_UTILITY_METHODS, FAVORITE_UTILITY_DEFINITION, createFavoriteUtilityPlan,
  supportsFavoriteUtilities, favoriteUtilityRankField, toFavoriteUtilityDocument,
  buildFavoriteUtilityQuery,
} from './favorite-utilities.mjs';

const ENCODINGS = Object.freeze({ rank18: Object.freeze({ limbs: 2, scale: 262143 }), rank27: Object.freeze({ limbs: 3, scale: 134217727 }) });
const original = FAVORITE_UTILITY_METHODS.find(method => method.encoding === 'numeric');
export const FAVORITE_PRECISION_METHODS = Object.freeze(Object.entries(ENCODINGS).map(([encoding, settings]) => Object.freeze({
  id: 'favorite-utility-' + encoding, encoding,
  label: `Favorite256: indexed utility, split ${encoding.slice(4)}-bit`,
  description: `The favorite's complete precomputed utility rounded to ${settings.scale + 1} levels and stored as ${settings.limbs} base512 rank features.`,
  family: 'favorite-precision-utilities', representation: 'favorite256-precomputed-utilities', searchKind: 'favorite-precision-utilities',
  approximate: false, objectiveApproximation: true,
  retrieval: 'Exact global ranking for the stored utility objective',
  objectivePrecision: `Target utility rounding error at most ${.5 / settings.scale} before query float32 multiplication and addition.`,
  limitations: Object.freeze([...original.limitations,
    `Each utility uses ${settings.limbs} nonnegative base512 digits, each no greater than 511 and exactly representable as a rank feature. Zero digits are omitted.`,
    'Additional stored precision does not avoid float32 query arithmetic or the changed grouping relative to the original five-layer query.']),
})));
export const FAVORITE_PRECISION_DEFINITION = Object.freeze({
  version: 1, parentUtilityDefinitionVersion: FAVORITE_UTILITY_DEFINITION.version,
  snapshot: 'strict-hue-favorite-001', encodings: ENCODINGS, base: 512,
  utility: FAVORITE_UTILITY_DEFINITION.utility,
  fieldLayout: 'Separate rank_features fields per encoding and quality/cutoff-weight preset; two or three positive digit features per complete target utility.',
  zero: FAVORITE_UTILITY_DEFINITION.zero,
  precision: 'Fixed-point digit quantization plus float32 query boosts/products/sum. Formula and observations stay unchanged at offered presets.',
});

export function favoritePrecisionMethod(input = 'favorite-utility-rank18') {
  const id = typeof input === 'string' ? input : input?.id;
  const method = FAVORITE_PRECISION_METHODS.find(candidate => candidate.id === id);
  if (!method) throw Error('Unknown favorite precision method: ' + id);
  return method;
}
function encodingFor(encoding) {
  if (!Object.hasOwn(ENCODINGS, encoding)) throw Error('Unsupported precision encoding: ' + encoding);
  return ENCODINGS[encoding];
}
function validateEncodings(encodings) {
  if (!Array.isArray(encodings) || !encodings.length || new Set(encodings).size !== encodings.length) throw Error('Use distinct nonempty precision encodings.');
  for (const encoding of encodings) encodingFor(encoding);
  return encodings;
}
export function favoritePrecisionDigits(value, encoding) {
  const { limbs, scale } = encodingFor(encoding);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw Error('Precision utility must be finite and within0..1.');
  let remainder = Math.round(value * scale);
  return Array.from({ length: limbs }, (_, i) => {
    const place = 512 ** (limbs - i - 1), digit = Math.floor(remainder / place);
    remainder -= digit * place;
    return digit;
  });
}
export function favoritePrecisionRankField(encoding, parameters = {}) {
  encodingFor(encoding);
  // Reuse the original preset validation/naming while keeping new fields apart.
  return favoriteUtilityRankField('rank16', parameters).replace('utility_rank16_', `utility_${encoding}_`);
}
export function favoritePrecisionEncodingValueCount(document, encoding) {
  encodingFor(encoding);
  return Object.entries(document).reduce((sum, [field, value]) => sum + (field.startsWith(`utility_${encoding}_`) ? Object.keys(value).length : 0), 0);
}
function fieldsFor(plan, encodings) {
  return [...new Set(encodings.flatMap(encoding => plan.descriptors.map(descriptor => favoritePrecisionRankField(encoding, descriptor.parameters))))];
}
export function supportsFavoritePrecision(methodInput, query, options = {}) {
  const method = favoritePrecisionMethod(methodInput);
  const result = supportsFavoriteUtilities('favorite-utility-numeric', query, options);
  return { ...result, warnings: [...(result.warnings ?? []), ...method.limitations] };
}
export function favoritePrecisionMapping(plan, { source = false, shards = 1, encodings = Object.keys(ENCODINGS) } = {}) {
  validateEncodings(encodings);
  if (!Number.isInteger(shards) || shards < 1) throw Error('Precision shard count must be a positive integer.');
  const properties = {
    id: { type: 'keyword' }, reference_id: { type: 'keyword' }, cohort: { type: 'keyword' },
    partition: { type: 'integer' }, tags: { type: 'keyword' },
  };
  for (const field of fieldsFor(plan, encodings)) properties[field] = { type: 'rank_features', positive_score_impact: true };
  return { settings: { number_of_shards: shards, number_of_replicas: 0, refresh_interval: '-1', 'index.mapping.total_fields.limit': Object.keys(properties).length + 20 },
    mappings: { dynamic: 'strict', _source: { enabled: source }, properties } };
}
export function toFavoritePrecisionDocument(measurement, plan, { encodings = Object.keys(ENCODINGS) } = {}) {
  validateEncodings(encodings);
  // Both encodings reuse one unchanged numeric precomputation pass.
  const { utilities, ...result } = toFavoriteUtilityDocument(measurement, plan, { encodings: ['numeric'] });
  for (const field of fieldsFor(plan, encodings)) result[field] = {};
  for (const descriptor of plan.descriptors) for (const encoding of encodings) {
    const field = favoritePrecisionRankField(encoding, descriptor.parameters);
    favoritePrecisionDigits(utilities[descriptor.key], encoding).forEach((digit, index) => {
      if (digit) result[field][descriptor.key + '_d' + index] = digit;
    });
  }
  return result;
}
export function buildFavoritePrecisionQuery({ method: input = 'favorite-utility-rank18', query, parameters = {}, ...options } = {}) {
  const method = favoritePrecisionMethod(input);
  const resolved = supportsFavoritePrecision(method, query, { parameters });
  if (!resolved.supported) throw Error(resolved.reason);
  const native = buildFavoriteUtilityQuery({ ...options, query, parameters, method: 'favorite-utility-numeric' });
  const { limbs, scale } = encodingFor(method.encoding), denominator = resolved.targets.length;
  const field = favoritePrecisionRankField(method.encoding, resolved.parameters);
  const should = resolved.utilities.flatMap(target => Array.from({ length: limbs }, (_, i) => ({ rank_feature: {
    field: field + '.' + target.key + '_d' + i, linear: {}, boost: 512 ** (limbs - i - 1) / (scale * denominator),
  } })));
  return { ...native, query: { bool: { ...native.query.bool, should } } };
}

/** Offline correctness oracle only; never retrieve and rerank service results. */
export function favoritePrecisionReference(measurement, query, { method: input = 'favorite-utility-rank18', parameters = {} } = {}) {
  const method = favoritePrecisionMethod(input);
  const resolved = supportsFavoritePrecision(method, query, { parameters });
  if (!resolved.supported) throw Error(resolved.reason);
  const plan = createFavoriteUtilityPlan({ requests: [{ query, parameters }] });
  const { utilities } = toFavoriteUtilityDocument(measurement, plan, { encodings: ['numeric'] });
  const { limbs, scale } = encodingFor(method.encoding), denominator = resolved.targets.length;
  let sum = 0;
  for (const target of resolved.utilities) {
    const digits = favoritePrecisionDigits(utilities[target.key], method.encoding);
    for (let i = 0; i < limbs; i++) sum += Math.fround(digits[i] * Math.fround(512 ** (limbs - i - 1) / (scale * denominator)));
  }
  return Math.fround(sum);
}
