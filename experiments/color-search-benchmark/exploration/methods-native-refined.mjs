// Query compilation only: OpenSearch native functions calculate every document score.
import { interpretQuery, metadataFilter } from './query.mjs';

const limitations = [
  'Named color/vibe features only; picked colors and custom ranges are unsupported.',
  'Scores average per-target affinity. They do not model a spatial accent or relative background contrast.',
  'Closed palettes have no separate outside-color purity penalty; unrelated colors affect only the requested feature areas.',
  'Native functions avoid Painless overhead, but exact scoring can still visit every eligible document. Million-document speed requires measurement.',
];
export const NATIVE_REFINED_METHODS = Object.freeze([
  { id: 'native-quality-linear', label: 'Native target areas + graded color quality', excessPenalty: 1 },
  { id: 'native-quality-asymmetric', label: 'Native graded quality + stronger excess-area penalty', excessPenalty: 1.5 },
].map(method => ({ ...method, family: 'native-refined', representation: 'named-features', searchKind: 'native-refined', approximate: false,
  description: 'Exact named-feature ordering using native OpenSearch decay and field functions; no scoring scripts.', limitations })));

function methodFor(input) {
  const method = NATIVE_REFINED_METHODS.find(item => item.id === (typeof input === 'string' ? input : input?.id));
  if (!method) throw Error(`Unknown native refinement: ${typeof input === 'string' ? input : input?.id}`);
  return method;
}

export function supportsNativeRefined(input, query, options = {}) {
  const method = methodFor(input), compiled = interpretQuery(query);
  if (!compiled.supported) return compiled;
  const warnings = [...method.limitations];
  if (compiled.customRanges || compiled.targets.some(target => !target.name)) return { supported: false, reason: 'Native quality functions require named features; picked colors and custom ranges are unsupported.', warnings };
  const names = new Set(compiled.targets.map(target => target.name));
  const accentIntent = compiled.mode === 'vibe' && ((names.has('dark') && names.has('bright')) || (names.has('grayscale') && names.has('red')));
  if (compiled.special || accentIntent) return { supported: false, reason: 'This native refinement has no relative-contrast or small-accent objective. Use an explicit proportion query or an accent-aware hybrid.', warnings };
  if (names.has('monochromatic') || names.has('rainbow')) warnings.push('Monochromatic and rainbow features measure global hue distribution, not literal area percentages.');
  if (compiled.subject && !options.eligibleIds) warnings.push('Subject is a mandatory indexed tag filter; imported images without that tag cannot match.');
  return { supported: true, compiled, warnings };
}

export function nativeRefinedParameters(input, supplied = {}) {
  const method = methodFor(input);
  const known = new Set(['areaPower', 'qualityPenalty', 'excessPenalty']);
  for (const name of Object.keys(supplied)) if (!known.has(name)) throw Error(`Unsupported native refinement parameter: ${name}`);
  const parameters = { areaPower: 0.5, qualityPenalty: 0.35, excessPenalty: method.excessPenalty, ...supplied };
  if (![0.5, 1].includes(parameters.areaPower)) throw Error('Native areaPower must be 0.5 or 1.');
  if (!Number.isFinite(parameters.qualityPenalty) || parameters.qualityPenalty < 0 || parameters.qualityPenalty > 1) throw Error('qualityPenalty must be between 0 and 1.');
  if (!Number.isFinite(parameters.excessPenalty) || parameters.excessPenalty < 1 || parameters.excessPenalty > 4) throw Error('excessPenalty must be between 1 and 4.');
  return parameters;
}

function targetFunctions(target, compiled, parameters) {
  const areaField = `cov_${target.name}`, qualityField = `quality_${target.name}`;
  if (compiled.mode === 'vibe') return [
    { field_value_factor: { field: areaField, factor: 0.0001, modifier: parameters.areaPower === 0.5 ? 'sqrt' : 'none', missing: 0 } },
    { field_value_factor: { field: qualityField, modifier: 'none', missing: 0 } },
  ];
  const origin = Math.round(target.amount * 10000);
  const area = penalty => ({ linear: { [areaField]: { origin, scale: 5000 / penalty, decay: 0.5, offset: 0 } } });
  const functions = parameters.excessPenalty === 1 ? [area(1)] : [
    { filter: { range: { [areaField]: { lte: origin } } }, ...area(1) },
    { filter: { range: { [areaField]: { gt: origin } } }, ...area(parameters.excessPenalty) },
  ];
  // A zero requested area means absence is desirable, so quality is irrelevant.
  // Linear decay yields exactly 1 - penalty * (1 - quality) on [0, 1].
  if (target.amount > 0 && parameters.qualityPenalty > 0) functions.push({ linear: {
    [qualityField]: { origin: 1, scale: 0.5, decay: 1 - parameters.qualityPenalty * 0.5, offset: 0 },
  } });
  return functions;
}

export function buildNativeRefinedQuery({ method: input, query, limit = 20, eligibleIds, excludedIds, filter, parameters: supplied = {} }) {
  const check = supportsNativeRefined(input, query, { eligibleIds, excludedIds });
  if (!check.supported) throw Error(check.reason);
  const { compiled } = check;
  const parameters = nativeRefinedParameters(input, supplied);
  const requiredFields = compiled.targets.flatMap(target => [
    { exists: { field: `cov_${target.name}` } },
    ...(compiled.mode === 'vibe' || target.amount > 0 ? [{ exists: { field: `quality_${target.name}` } }] : []),
  ]);
  const eligibility = metadataFilter({ eligibleIds, excludedIds, filter, compiled });
  return {
    size: limit, _source: false, track_total_hits: false,
    query: { bool: {
      filter: [eligibility, ...requiredFields], minimum_should_match: 1,
      should: compiled.targets.map(target => ({ function_score: {
        query: { match_all: {} }, functions: [...targetFunctions(target, compiled, parameters), { weight: 1 / compiled.targets.length }],
        score_mode: 'multiply', boost_mode: 'replace',
      } })),
    } },
    sort: [{ _score: 'desc' }, { id: 'asc' }],
  };
}
