// THROWAWAY PROTOTYPE. Compile native functions; OpenSearch orders every eligible document.
// Overlapping regions are independent observations, never additive image allocations.
import { interpretQuery, metadataFilter } from './query.mjs';
import { OVERLAP_DEFINITION, nearestOverlapRegion, regionFields } from './overlap-regions.mjs';

const CONCRETE_COLORS = new Set(['red', 'orange', 'yellow', 'green', 'teal', 'cyan', 'blue', 'purple', 'pink', 'brown', 'black', 'gray', 'white']);
const LIMITATIONS = Object.freeze([
  'A sampled pixel may contribute to many regions. Coverage is marginal; overlapping areas must not be summed into a union or an exclusive palette.',
  'Picked colors resolve to one nearest indexed anchor. The fixed OKLab radius is 0.12, with quality falling from 1 at the anchor to 0.5 at the edge.',
  'Closed palettes have no separate outside-color purity penalty. Requested marginal amounts do not prove that other colors are absent.',
  'Native functions score globally without application reranking. Query cost can still grow with eligible document count and must be measured.',
]);

export const OVERLAP_METHODS = Object.freeze([
  { id: 'overlap-quality-dense', label: 'Overlapping 1,024 regions: coverage + quality', namedMode: 'concrete-swatches',
    description: 'Concrete named colors and picked colors use independently measured overlapping OKLab neighborhoods; abstract vibes retain named features.' },
  { id: 'overlap-quality-hybrid', label: 'Overlapping regions + named color families', namedMode: 'named-families',
    description: 'Named colors and vibes retain broad named features; picked colors use the same 1,024 overlapping neighborhoods.' },
].map(method => Object.freeze({ ...method, family: 'overlap-quality', representation: 'overlap-coverage-quality-1024', searchKind: 'overlap', approximate: false, limitations: LIMITATIONS })));

function methodFor(input) {
  const id = typeof input === 'string' ? input : input?.id;
  const method = OVERLAP_METHODS.find(candidate => candidate.id === id);
  if (!method) throw Error(`Unknown overlapping-region method: ${id}`);
  return method;
}

function resolveCompiled(method, compiled) {
  return compiled.targets.map((target, targetIndex) => {
    const useRegion = !target.name || target.ranges.length > 0 || (method.namedMode === 'concrete-swatches' && CONCRETE_COLORS.has(target.name));
    const region = useRegion ? nearestOverlapRegion(target.lab) : null;
    const fields = region ? regionFields(region.index) : { coverage: `cov_${target.name}`, quality: `quality_${target.name}` };
    return {
      targetIndex, kind: region ? 'region' : 'named', name: target.name ?? null, color: target.color ?? null,
      amount: target.amount, regionIndex: region?.index ?? null, regionHex: region?.hex ?? null,
      anchorDistance: region ? Math.hypot(...target.lab.map((value, channel) => value - region.lab[channel])) : null,
      coverageField: fields.coverage, qualityField: fields.quality,
    };
  });
}

export function supportsOverlap(input, query, options = {}) {
  const method = methodFor(input), compiled = interpretQuery(query), warnings = [...LIMITATIONS];
  if (!compiled.supported) return compiled;
  for (const target of compiled.targets) {
    if (Math.abs(target.edgeWeight - OVERLAP_DEFINITION.edgeWeight) > 1e-12) return { supported: false, reason: 'This indexed prototype supports edge quality 0.5 only.', warnings };
    const needsRange = !target.name || target.explicitRanges;
    if (needsRange && (target.ranges.length !== 1 || target.ranges[0].space !== 'oklab' || Math.abs(target.ranges[0].distance - OVERLAP_DEFINITION.radius) > 1e-12)) {
      return { supported: false, reason: 'This indexed prototype supports one fixed OKLab distance of 0.12. Other radii and RGB/HSV/HSL channel ranges are unsupported.', warnings };
    }
  }
  const names = new Set(compiled.targets.map(target => target.name));
  const accentIntent = compiled.mode === 'vibe' && ((names.has('dark') && names.has('bright')) || (names.has('grayscale') && names.has('red')));
  if (compiled.special || accentIntent) return { supported: false, reason: 'This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.', warnings };
  const targets = resolveCompiled(method, compiled);
  if (method.namedMode === 'concrete-swatches' && targets.some(target => target.kind === 'region' && target.name)) {
    warnings.push('Dense mode interprets concrete color names, including black, gray and white, as literal neighborhoods around their displayed swatches, not their full named color families. Dark and grayscale remain separate named vibes.');
  }
  if (targets.some(target => target.kind === 'region')) warnings.push('Nearest-anchor quantization is shown in the inspector. Quality is measured against that indexed anchor, rather than the exact requested hex.');
  if (names.has('monochromatic') || names.has('rainbow')) warnings.push('Monochromatic and rainbow features describe global hue distribution, not literal area percentages.');
  const selected = targets.filter(target => target.kind === 'region').map(target => target.regionIndex);
  if (new Set(selected).size < selected.length) warnings.push('Several requested colors resolve to the same region. Their target terms reuse the same area and quality observations.');
  if (compiled.subject && !options.eligibleIds) warnings.push('Subject is a mandatory indexed tag filter; images without that tag cannot match.');
  return { supported: true, compiled, targets, warnings };
}

export function resolveOverlapTargets(input, query, options = {}) {
  const result = supportsOverlap(input, query, options);
  if (!result.supported) throw Error(result.reason);
  return result;
}

export function overlapParameters(input, supplied = {}) {
  methodFor(input);
  const known = new Set(['areaPower', 'qualityPenalty', 'excessPenalty']);
  for (const name of Object.keys(supplied)) if (!known.has(name)) throw Error(`Unsupported overlapping-region parameter: ${name}`);
  const parameters = { areaPower: .5, qualityPenalty: .35, excessPenalty: 1.5, ...supplied };
  if (![.5, 1].includes(parameters.areaPower)) throw Error('Native areaPower must be 0.5 or 1.');
  if (!Number.isFinite(parameters.qualityPenalty) || parameters.qualityPenalty < 0 || parameters.qualityPenalty > 1) throw Error('qualityPenalty must be between 0 and 1.');
  if (!Number.isFinite(parameters.excessPenalty) || parameters.excessPenalty < 1 || parameters.excessPenalty > 4) throw Error('excessPenalty must be between 1 and 4.');
  return parameters;
}

function targetFunctions(target, compiled, parameters) {
  const areaField = target.coverageField, qualityField = target.qualityField;
  if (compiled.mode === 'vibe') return [
    { field_value_factor: { field: areaField, factor: .0001, modifier: parameters.areaPower === .5 ? 'sqrt' : 'none', missing: 0 } },
    { field_value_factor: { field: qualityField, modifier: 'none', missing: 0 } },
  ];
  const origin = Math.round(target.amount * 10000);
  const area = penalty => ({ linear: { [areaField]: { origin, scale: 5000 / penalty, decay: .5, offset: 0 } } });
  const functions = parameters.excessPenalty === 1 ? [area(1)] : [
    { filter: { range: { [areaField]: { lte: origin } } }, ...area(1) },
    { filter: { range: { [areaField]: { gt: origin } } }, ...area(parameters.excessPenalty) },
  ];
  if (target.amount > 0 && parameters.qualityPenalty > 0) functions.push({ linear: {
    [qualityField]: { origin: 1, scale: .5, decay: 1 - parameters.qualityPenalty * .5, offset: 0 },
  } });
  return functions;
}

export function buildOverlapQuery({ method, query, limit = 20, eligibleIds, excludedIds, filter, parameters: supplied = {} }) {
  const { compiled, targets } = resolveOverlapTargets(method, query, { eligibleIds, excludedIds });
  const parameters = overlapParameters(method, supplied);
  const requiredFields = [...new Set(targets.flatMap(target => [target.coverageField, ...(compiled.mode === 'vibe' || target.amount > 0 ? [target.qualityField] : [])]))].map(field => ({ exists: { field } }));
  return {
    size: limit, _source: false, track_total_hits: false,
    query: { bool: {
      filter: [metadataFilter({ eligibleIds, excludedIds, filter, compiled }), ...requiredFields], minimum_should_match: 1,
      should: targets.map(target => ({ function_score: {
        query: { match_all: {} }, functions: [...targetFunctions(target, compiled, parameters), { weight: 1 / targets.length }],
        score_mode: 'multiply', boost_mode: 'replace',
      } })),
    } },
    sort: [{ _score: 'desc' }, { id: 'asc' }],
  };
}
