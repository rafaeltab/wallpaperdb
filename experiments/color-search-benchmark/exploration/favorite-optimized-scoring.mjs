// THROWAWAY PROTOTYPE. Execute the saved favorite in one global OpenSearch
// script, using exactly the original indexed observations and eligibility.
// Pure functions below are extraction/test/diagnostic helpers, never a client
// reranker. No saved favorite source or index is changed by this module.
import { buildCutoffQuery, cutoffParameters, resolveCutoffTargets, supportsCutoff } from './methods-cutoff.mjs';

export const FAVORITE_SOURCE_METHOD = 'cutoff-shade-hue-all-levels';
export const FAVORITE_OPTIMIZED_METHODS = Object.freeze([Object.freeze({
  id: 'favorite-fused-script', label: 'Favorite optimization: fused score',
  description: 'The saved strict-hue five-layer formula executed in one OpenSearch script. Uses existing coverage and quality fields; preserves all controls and global ranking.',
  family: 'favorite-optimized', representation: 'shade-hue-coverage-quality-256', searchKind: 'favorite-optimized',
  approximate: false, sourceMethod: FAVORITE_SOURCE_METHOD, metric: 'shade-hue-aware', profile: 'all-levels',
  limitations: Object.freeze([
    'Retains the saved favorite color measurements, anchor quantization, marginal proportions and lack of an independent outside-color purity penalty.',
    'Reproduces the native factor, weight and component float rounding; exact tied-result parity still depends on the OpenSearch/Lucene scorer implementation and is checked experimentally.',
    'Scoring remains global and scans eligible documents. Fusing scoring machinery is an execution experiment, not a proven scalability improvement.',
  ]),
})]);

const DEFAULT_PARAMETERS = Object.freeze({ bucketCount: 256, cutoffBlendExponent: 1, qualityCurve: 'linear', qualityInfluence: .5 });

function methodFor(input = 'favorite-fused-script') {
  const id = typeof input === 'string' ? input : input?.id;
  const method = FAVORITE_OPTIMIZED_METHODS.find(candidate => candidate.id === id);
  if (!method) throw Error(`Unknown favorite optimized method: ${id}`);
  return method;
}

export function favoriteOptimizedParameters(supplied = {}) {
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw Error('Favorite optimized parameters must be an object.');
  return cutoffParameters(FAVORITE_SOURCE_METHOD, { ...DEFAULT_PARAMETERS, ...supplied });
}

export function supportsFavoriteOptimized(method, query, options = {}) {
  const selected = methodFor(method), parameters = favoriteOptimizedParameters(options.parameters);
  const result = supportsCutoff(FAVORITE_SOURCE_METHOD, query, { ...options, parameters });
  return { ...result, warnings: [...(result.warnings ?? []), ...selected.limitations] };
}

function qualityPlan(parameters, vibe, amount) {
  const qualityApplies = vibe || amount > 0;
  const influence = parameters.qualityInfluence;
  const penalty = vibe ? 1 : parameters.qualityPenalty;
  const strength = penalty * influence;
  let qualityKind = 'none', qualityScale = 0;
  if (qualityApplies && strength !== 0) {
    const nativeLinear = parameters.qualityCurve === 'linear' || influence === 0 || influence === 1 || penalty === 0;
    if (!nativeLinear) qualityKind = 'power';
    else if (vibe && strength === 1) qualityKind = 'direct';
    else {
      qualityKind = 'linear';
      const scale = strength <= 1 ? .5 : .5 / strength;
      const decay = strength <= 1 ? 1 - strength * .5 : .5;
      // Preserve OpenSearch LinearDecayFunctionBuilder.processScale/evaluate
      // order, including rounding. Do not simplify this to 1 / strength.
      qualityScale = scale / (1 - decay);
    }
  }
  return { qualityApplies, qualityRequired: qualityApplies && (influence > 0 || parameters.minimumQuality > 0), qualityKind, qualityScale,
    qualityPenalty: penalty, qualityInfluence: influence, minimumQuality: Math.fround(parameters.minimumQuality) };
}

export function compileFavoriteScorePlan({ query, parameters: supplied = {} }) {
  const parameters = favoriteOptimizedParameters(supplied);
  const { compiled, targets, warnings } = resolveCutoffTargets(FAVORITE_SOURCE_METHOD, query, { parameters });
  const vibe = compiled.mode === 'vibe';
  const components = targets.flatMap(target => target.components.map(component => ({
    ...target, ...component,
    vibe, weight: Math.fround(component.componentWeight / targets.length), origin: Math.round(target.amount * 10000),
    areaFactor: Math.fround(.0001), areaPower: parameters.areaPower,
    underScale: 5000 / .5, overScale: (5000 / parameters.excessPenalty) / .5,
    ...qualityPlan(parameters, vibe, target.amount),
  })));
  return { parameters, compiled, targets, warnings, components };
}

function requiredMeasurement(document, field) {
  if (!Object.hasOwn(document, field) || !Number.isFinite(document[field])) throw Error(`Missing or non-finite favorite measurement: ${field}`);
  return document[field];
}

// Numeric details modeled on OpenSearch 2.11.0 FieldValueFactorFunction,
// LinearDecayFunctionBuilder, WeightFactorFunction and FunctionScoreQuery.
// https://github.com/opensearch-project/OpenSearch/tree/2.11.0/server/src/main/java/org/opensearch/common/lucene/search/function
export function scoreFavoriteComponent(document, component) {
  const coverage = requiredMeasurement(document, component.coverageField);
  const quality = component.qualityRequired ? Math.fround(requiredMeasurement(document, component.qualityField)) : 0;
  if (component.qualityApplies && component.minimumQuality > 0 && quality < component.minimumQuality) return 0;
  let area;
  if (component.vibe) {
    area = coverage * component.areaFactor;
    if (component.areaPower === .5) area = Math.sqrt(area);
  } else {
    const scale = coverage <= component.origin ? component.underScale : component.overScale;
    area = Math.max(0, (scale - Math.abs(coverage - component.origin)) / scale);
  }
  let factor = 1;
  if (component.qualityKind === 'direct') factor = quality;
  else if (component.qualityKind === 'linear') factor = Math.max(0, (component.qualityScale - Math.abs(1 - quality)) / component.qualityScale);
  else if (component.qualityKind === 'power') factor = Math.pow(Math.max(0, Math.min(1, 1 - component.qualityPenalty * (1 - quality))), component.qualityInfluence);
  return Math.fround(area * factor * component.weight);
}

export function scoreFavoriteReference(document, plan) {
  return Math.fround(plan.components.reduce((score, component) => score + scoreFavoriteComponent(document, component), 0));
}

// Keep the source constant across colors, target counts and quality controls.
// Stored scripts/compilation caches can therefore reuse one compiled program.
export const FAVORITE_FUSED_SCRIPT = `
double total = 0.0;
boolean vibe = (boolean)params.vibe;
boolean squareRoot = (boolean)params.squareRoot;
double areaFactor = ((Number)params.areaFactor).doubleValue();
double underScale = ((Number)params.underScale).doubleValue();
double overScale = ((Number)params.overScale).doubleValue();
double minimumQuality = ((Number)params.minimumQuality).doubleValue();
double qualityScale = ((Number)params.qualityScale).doubleValue();
double qualityPenalty = ((Number)params.qualityPenalty).doubleValue();
double qualityInfluence = ((Number)params.qualityInfluence).doubleValue();
int qualityKind = ((Number)params.qualityKind).intValue();
for (int i = 0; i < params.coverageFields.size(); ++i) {
  double coverage = ((Number)doc[(String)params.coverageFields.get(i)].value).doubleValue();
  boolean qualityApplies = (boolean)params.qualityApplies.get(i);
  double quality = 0.0;
  if ((boolean)params.qualityRequired.get(i)) {
    quality = ((Number)doc[(String)params.qualityFields.get(i)].value).doubleValue();
  }
  if (qualityApplies && minimumQuality > 0.0 && quality < minimumQuality) continue;
  double area;
  if (vibe) {
    area = coverage * areaFactor;
    if (squareRoot) area = Math.sqrt(area);
  } else {
    double origin = ((Number)params.origins.get(i)).doubleValue();
    double scale = coverage <= origin ? underScale : overScale;
    area = Math.max(0.0, (scale - Math.abs(coverage - origin)) / scale);
  }
  double qualityFactor = 1.0;
  if (qualityApplies) {
    if (qualityKind == 1) qualityFactor = quality;
    else if (qualityKind == 2) qualityFactor = Math.max(0.0, (qualityScale - Math.abs(1.0 - quality)) / qualityScale);
    else if (qualityKind == 3) qualityFactor = Math.pow(Math.max(0.0, Math.min(1.0, 1.0 - qualityPenalty * (1.0 - quality))), qualityInfluence);
  }
  double weight = ((Number)params.weights.get(i)).doubleValue();
  total += (float)(area * qualityFactor * weight);
}
return (float)total;
`;

export function buildFavoriteOptimizedQuery({ method = 'favorite-fused-script', query, parameters: supplied = {}, ...options }) {
  methodFor(method);
  const plan = compileFavoriteScorePlan({ query, parameters: supplied });
  const native = buildCutoffQuery({ ...options, method: FAVORITE_SOURCE_METHOD, query, parameters: plan.parameters });
  // Use a positive target to obtain the shared quality formula, since a zero
  // target disables quality for that term but must not disable other terms.
  const quality = qualityPlan(plan.parameters, plan.compiled.mode === 'vibe', 1);
  const first = plan.components[0];
  const params = {
    vibe: first.vibe, squareRoot: plan.parameters.areaPower === .5,
    areaFactor: first.areaFactor, underScale: first.underScale, overScale: first.overScale,
    minimumQuality: quality.minimumQuality, qualityScale: quality.qualityScale,
    qualityPenalty: quality.qualityPenalty, qualityInfluence: quality.qualityInfluence,
    qualityKind: ['none', 'direct', 'linear', 'power'].indexOf(quality.qualityKind),
    coverageFields: plan.components.map(component => component.coverageField),
    qualityFields: plan.components.map(component => component.qualityField),
    origins: plan.components.map(component => component.origin),
    weights: plan.components.map(component => component.weight),
    qualityRequired: plan.components.map(component => component.qualityRequired),
    qualityApplies: plan.components.map(component => component.qualityApplies),
  };
  return { ...native, query: { script_score: {
    query: { bool: { filter: native.query.bool.filter } },
    script: { lang: 'painless', source: FAVORITE_FUSED_SCRIPT, params },
  } } };
}
