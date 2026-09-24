// THROWAWAY PROTOTYPE. OpenSearch globally scores indexed cutoff measurements.
// Pixel admission (pixelCutoff) and average bin quality (minimumQuality) are different controls.
import { interpretQuery, metadataFilter } from './query.mjs';
import { overlapParameters } from './methods-overlap.mjs';
import { nearestOverlapRegionForCount } from './overlap-banks.mjs';
import { CUTOFF_LEVELS, cutoffFields } from './cutoff-definition.mjs';
import { CUTOFF_QUERY_PROFILES, cutoffQueryComponents } from './cutoff-blend.mjs';
import { qualityFunctions } from './quality-curve.mjs';

const CONCRETE_COLORS = new Set(['red', 'orange', 'yellow', 'green', 'teal', 'cyan', 'blue', 'purple', 'pink', 'brown', 'black', 'gray', 'white']);
const LIMITATIONS = Object.freeze([
  'A pixel may contribute to several regions. These are marginal observations, not an exclusive palette; there is no separate outside-color purity penalty.',
  'Picked colors use the nearest indexed anchor. Pixel quality is max(0, 1 - OKLab distance / 0.24), with finite support and a configurable admission cutoff.',
  'Feather and core-halo percentages are effective coverage weighted by pixel admission; hard-cutoff percentages are literal covered area.',
  'Consensus averages independently scored cutoff components. Averaged coverage and quality are display summaries, never the scoring input.',
  'OpenSearch ranks globally. Linear quality uses native functions; power quality may use a Painless score function. Small-corpus timings do not establish million-wallpaper latency.',
]);
export const CUTOFF_METHODS = Object.freeze(CUTOFF_QUERY_PROFILES.map(profile => Object.freeze({
  id: `cutoff-${profile.id}`, label: `Pixel cutoff: ${profile.label}`, description: profile.description,
  profile: profile.id, family: 'cutoff-quality', representation: 'cutoff-coverage-quality-1024', searchKind: 'cutoff',
  approximate: false, limitations: LIMITATIONS,
})));

function methodFor(input) {
  const id = typeof input === 'string' ? input : input?.id;
  const method = CUTOFF_METHODS.find(candidate => candidate.id === id);
  if (!method) throw Error(`Unknown cutoff method: ${id}`);
  return method;
}

export function cutoffParameters(input, supplied = {}) {
  const method = methodFor(input);
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw Error('Cutoff parameters must be an object.');
  const { pixelCutoff = .5, namedMode = 'concrete-swatches', cutoffBlendExponent = 0, ...scoring } = supplied;
  if (!CUTOFF_LEVELS.some(level => level.cutoff === pixelCutoff)) throw Error('pixelCutoff must be 0, 0.25, 0.5, 0.75 or 0.9.');
  if (!['concrete-swatches', 'named-families'].includes(namedMode)) throw Error('namedMode must be concrete-swatches or named-families.');
  if (method.profile !== 'all-levels' && Object.hasOwn(supplied, 'cutoffBlendExponent')) throw Error('cutoffBlendExponent is only supported by cutoff-all-levels.');
  if (method.profile === 'all-levels') cutoffQueryComponents(method.profile, 0, cutoffBlendExponent);
  return { ...overlapParameters('overlap-quality-dense', scoring), pixelCutoff: method.profile === 'all-levels' ? 0 : pixelCutoff, namedMode,
    ...(method.profile === 'all-levels' ? { cutoffBlendExponent } : {}),
  };
}

export function cutoffTargetComponents(region, profile, pixelCutoff, cutoffBlendExponent = 0) {
  return cutoffQueryComponents(profile, pixelCutoff, cutoffBlendExponent).map((component, componentIndex) => {
    const fields = cutoffFields(region.index, component.kernel, component.cutoff);
    return { componentIndex, kernel: component.kernel, pixelCutoff: component.cutoff, componentWeight: component.weight,
      coverageField: fields.coverage, qualityField: fields.quality,
      physicalCoverageField: cutoffFields(region.index, 'hard', component.cutoff).coverage,
      coverageKind: component.kernel === 'hard' ? 'physical' : 'effective',
    };
  });
}

export function supportsCutoff(input, query, options = {}) {
  const method = methodFor(input), parameters = cutoffParameters(method, options.parameters);
  const compiled = interpretQuery(query), warnings = [...LIMITATIONS];
  if (!compiled.supported) return compiled;
  const level = CUTOFF_LEVELS.find(candidate => candidate.cutoff === parameters.pixelCutoff);
  for (const target of compiled.targets) {
    if (method.profile === 'all-levels' && target.explicitRanges) return { supported: false, reason: 'All cutoffs blends several supports and does not implement explicit ranges. Use a single-cutoff prototype for an explicit OKLab distance.', warnings };
    if (Math.abs(target.edgeWeight - .5) > 1e-12) return { supported: false, reason: 'This prototype uses a fixed reference quality scale; custom edgeWeight is unsupported. Use pixelCutoff and the profile controls.', warnings };
    if (target.explicitRanges && (target.ranges.length !== 1 || target.ranges[0].space !== 'oklab' || Math.abs(target.ranges[0].distance - level.radius) > 1e-12)) {
      return { supported: false, reason: `Explicit ranges must be one OKLab distance matching the selected pixel cutoff (${level.radius}). RGB/HSV/HSL ranges are unsupported.`, warnings };
    }
  }
  const names = new Set(compiled.targets.map(target => target.name));
  const accentIntent = compiled.mode === 'vibe' && ((names.has('dark') && names.has('bright')) || (names.has('grayscale') && names.has('red')));
  if (compiled.special || accentIntent) return { supported: false, reason: 'This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.', warnings };
  const targets = compiled.targets.map((target, targetIndex) => {
    const useRegion = !target.name || target.ranges.length > 0 || (parameters.namedMode === 'concrete-swatches' && CONCRETE_COLORS.has(target.name));
    const region = useRegion ? nearestOverlapRegionForCount(target.lab, parameters.bucketCount) : null;
    const components = region ? cutoffTargetComponents(region, method.profile, parameters.pixelCutoff, parameters.cutoffBlendExponent) : [{
      componentIndex: 0, kernel: 'named', pixelCutoff: null, componentWeight: 1,
      coverageField: `cov_${target.name}`, qualityField: `quality_${target.name}`, physicalCoverageField: `cov_${target.name}`, coverageKind: 'named',
    }];
    return { targetIndex, kind: region ? 'region' : 'named', name: target.name ?? null, color: target.color ?? null,
      amount: target.amount, regionIndex: region?.index ?? null, regionHex: region?.hex ?? null,
      anchorDistance: region ? Math.hypot(...target.lab.map((value, channel) => value - region.lab[channel])) : null,
      coverageField: components[0].coverageField, qualityField: components[0].qualityField,
      components, coverageKind: components.length > 1 ? 'component-summary' : components[0].coverageKind,
    };
  });
  if (targets.some(target => target.kind === 'region')) warnings.push('Quality and pixel admission are measured against the selected indexed anchor, not the exact requested hex.');
  if (parameters.namedMode === 'concrete-swatches' && targets.some(target => target.kind === 'region' && target.name)) warnings.push('Concrete color names use literal swatch neighborhoods. Abstract vibes, such as dark and grayscale, keep their named features.');
  if (targets.some(target => target.kind === 'named')) warnings.push('Named-family and abstract-vibe features retain their original definitions and are scored once; pixel cutoff and profile only change indexed color regions.');
  if (method.profile === 'all-levels') warnings.push('All five stored hard cutoffs contribute with positive distribution weights. The starting pixel cutoff is unused. Minimum average quality can still zero a component without redistributing its weight.');
  const selected = targets.filter(target => target.kind === 'region').map(target => target.regionIndex);
  if (new Set(selected).size < selected.length) warnings.push('Several requested colors resolve to the same region and reuse its observations.');
  if (compiled.subject && !options.eligibleIds) warnings.push('Subject is a mandatory indexed tag filter.');
  return { supported: true, compiled, targets, warnings };
}

export function resolveCutoffTargets(input, query, options = {}) {
  const result = supportsCutoff(input, query, options);
  if (!result.supported) throw Error(result.reason);
  return result;
}

function targetFunctions(target, compiled, parameters) {
  const areaField = target.coverageField, qualityField = target.qualityField;
  // Quality is indexed as float32. Round the inclusive boundary identically in
  // the native range and diagnostic ledger, so e.g. an indexed 0.7 passes 70%.
  // A failing term gets multiplied by zero; it does not filter the wallpaper or
  // change the denominator used to average the requested target terms.
  const gate = parameters.minimumQuality > 0 && (compiled.mode === 'vibe' || target.amount > 0)
    ? [{ filter: { range: { [qualityField]: { lt: Math.fround(parameters.minimumQuality) } } }, weight: 0 }] : [];
  if (compiled.mode === 'vibe') return [
    { field_value_factor: { field: areaField, factor: .0001, modifier: parameters.areaPower === .5 ? 'sqrt' : 'none', missing: 0 } },
    ...qualityFunctions(qualityField, parameters, compiled.mode),
    ...gate,
  ];
  const origin = Math.round(target.amount * 10000);
  const area = penalty => ({ linear: { [areaField]: { origin, scale: 5000 / penalty, decay: .5, offset: 0 } } });
  const functions = parameters.excessPenalty === 1 ? [area(1)] : [
    { filter: { range: { [areaField]: { lte: origin } } }, ...area(1) },
    { filter: { range: { [areaField]: { gt: origin } } }, ...area(parameters.excessPenalty) },
  ];
  if (target.amount > 0) functions.push(...qualityFunctions(qualityField, parameters, compiled.mode));
  functions.push(...gate);
  return functions;
}

export function buildCutoffQuery({ method = 'cutoff-hard', query, limit = 20, eligibleIds, excludedIds, filter, parameters: supplied = {} }) {
  const parameters = cutoffParameters(method, supplied);
  const { compiled, targets } = resolveCutoffTargets(method, query, { eligibleIds, excludedIds, parameters });
  const components = targets.flatMap(target => target.components.map(component => ({ ...target, ...component })));
  const requiredFields = [...new Set(components.flatMap(component => [component.coverageField,
    ...((parameters.qualityInfluence > 0 || parameters.minimumQuality > 0) && (compiled.mode === 'vibe' || component.amount > 0) ? [component.qualityField] : []),
  ]))].map(field => ({ exists: { field } }));
  return {
    size: limit, _source: false, track_total_hits: false,
    query: { bool: {
      filter: [metadataFilter({ eligibleIds, excludedIds, filter, compiled }), ...requiredFields], minimum_should_match: 1,
      should: components.map(component => ({ function_score: {
        query: { match_all: {} }, functions: [...targetFunctions(component, compiled, parameters), { weight: component.componentWeight / targets.length }],
        score_mode: 'multiply', boost_mode: 'replace',
      } })),
    } },
    sort: [{ _score: 'desc' }, { id: 'asc' }],
  };
}
