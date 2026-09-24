// THROWAWAY execution refinement. Global OpenSearch scoring, unchanged saved
// observations and mathematical/float32 operations. No application reranking.
import { buildCutoffQuery, supportsCutoff } from './methods-cutoff.mjs';
import { FAVORITE_SOURCE_METHOD, compileFavoriteScorePlan, favoriteOptimizedParameters } from './favorite-optimized-scoring.mjs';

export const FAVORITE_TYPED_METHODS = Object.freeze([Object.freeze({
  id: 'favorite-typed-script', label: 'Favorite optimization: typed specialized score',
  description: 'The original five-cutoff formula in a typed, unrolled OpenSearch script. Specializes execution by component count and formula kind while preserving the existing controls.',
  family: 'favorite-typed', representation: 'shade-hue-coverage-quality-256', searchKind: 'favorite-typed',
  approximate: false, sourceMethod: FAVORITE_SOURCE_METHOD, metric: 'shade-hue-aware', profile: 'all-levels',
  limitations: Object.freeze([
    'Global scoring still visits eligible documents; this is an execution experiment with no indexed score bounds.',
    'Retains native float32 weights, area factor, cutoff contribution casts and final sum cast. Real-service equivalence must be verified.',
    'Field names, percentages, weights and control values remain parameters. Script source varies only by 1..50 component count, three area modes and four quality kinds: at most 600 structural variants, generated lazily. Many mixed shapes can churn the compilation cache.',
    'Retains the favorite’s anchor quantization, marginal overlap and lack of an independent outside-color purity objective.',
  ]),
})]);

function methodFor(input = 'favorite-typed-script') {
  const id = typeof input === 'string' ? input : input?.id;
  const method = FAVORITE_TYPED_METHODS.find(candidate => candidate.id === id);
  if (!method) throw Error('Unknown favorite typed method: ' + id);
  return method;
}

export function supportsFavoriteTyped(method, query, options = {}) {
  const selected = methodFor(method), parameters = favoriteOptimizedParameters(options.parameters);
  const result = supportsCutoff(FAVORITE_SOURCE_METHOD, query, { ...options, parameters });
  return { ...result, warnings: [...(result.warnings ?? []), ...selected.limitations] };
}

/** Only structural dimensions enter the source. Unrolling removes component
 * list lookups and mode branches; flat parameters are unboxed into typed locals.
 * Per-component applies/required flags remain parameters so zero-target masks
 * and quality-gate settings do not create additional compiled source variants. */
export function compileFavoriteTypedScript(plan) {
  if (!plan?.components?.length || plan.components.length > 50) throw Error('Typed kernel requires 1..50 score components.');
  const first = plan.components[0], vibe = first.vibe;
  const quality = plan.components.find(component => component.qualityKind !== 'none') ?? first;
  const kind = quality.qualityKind;
  if (!['none', 'direct', 'linear', 'power'].includes(kind)) throw Error('Unsupported typed quality kind: ' + kind);
  const params = { minimumQuality: quality.minimumQuality };
  const lines = ['double total = 0.0;', 'double minimumQuality = (double)params.minimumQuality;'];
  if (vibe) {
    params.areaFactor = first.areaFactor;
    lines.push('double areaFactor = (double)params.areaFactor;');
  } else {
    params.underScale = first.underScale; params.overScale = first.overScale;
    lines.push('double underScale = (double)params.underScale;', 'double overScale = (double)params.overScale;');
  }
  if (kind === 'linear') {
    params.qualityScale = quality.qualityScale;
    lines.push('double qualityScale = (double)params.qualityScale;');
  }
  if (kind === 'power') {
    params.qualityPenalty = quality.qualityPenalty; params.qualityInfluence = quality.qualityInfluence;
    lines.push('double qualityPenalty = (double)params.qualityPenalty;', 'double qualityInfluence = (double)params.qualityInfluence;');
  }
  plan.components.forEach((component, i) => {
    params['c' + i] = component.coverageField;
    params['q' + i] = component.qualityField;
    params['a' + i] = component.qualityApplies;
    params['r' + i] = component.qualityRequired;
    params['w' + i] = component.weight;
    lines.push(
      `double coverage${i} = (double)doc[(String)params.c${i}].value;`,
      `boolean applies${i} = (boolean)params.a${i};`,
      `boolean required${i} = (boolean)params.r${i};`,
      `double quality${i} = 0.0;`,
      `if (required${i}) quality${i} = (double)doc[(String)params.q${i}].value;`,
      `if (!applies${i} || minimumQuality <= 0.0 || quality${i} >= minimumQuality) {`,
    );
    if (vibe) {
      lines.push(`double area${i} = coverage${i} * areaFactor;`);
      if (plan.parameters.areaPower === .5) lines.push(`area${i} = Math.sqrt(area${i});`);
    } else {
      params['o' + i] = component.origin;
      lines.push(`double origin${i} = (double)params.o${i};`,
        `double scale${i} = coverage${i} <= origin${i} ? underScale : overScale;`,
        `double area${i} = Math.max(0.0, (scale${i} - Math.abs(coverage${i} - origin${i})) / scale${i});`);
    }
    lines.push(`double factor${i} = 1.0;`);
    if (kind === 'direct') lines.push(`if (applies${i}) factor${i} = quality${i};`);
    if (kind === 'linear') lines.push(`if (applies${i}) factor${i} = Math.max(0.0, (qualityScale - Math.abs(1.0 - quality${i})) / qualityScale);`);
    if (kind === 'power') lines.push(`if (applies${i}) factor${i} = Math.pow(Math.max(0.0, Math.min(1.0, 1.0 - qualityPenalty * (1.0 - quality${i}))), qualityInfluence);`);
    lines.push(`double weight${i} = (double)params.w${i};`, `total += (float)(area${i} * factor${i} * weight${i});`, '}');
  });
  lines.push('return (float)total;');
  return { lang: 'painless', source: lines.join('\n'), params };
}

export function buildFavoriteTypedQuery({ method = 'favorite-typed-script', query, parameters = {}, ...options } = {}) {
  methodFor(method);
  const plan = compileFavoriteScorePlan({ query, parameters });
  const native = buildCutoffQuery({ ...options, method: FAVORITE_SOURCE_METHOD, query, parameters: plan.parameters });
  return { ...native, query: { script_score: {
    query: { bool: { filter: native.query.bool.filter } }, script: compileFavoriteTypedScript(plan),
  } } };
}
