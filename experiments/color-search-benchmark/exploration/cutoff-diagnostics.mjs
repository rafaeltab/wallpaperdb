// THROWAWAY diagnostics: OpenSearch scores globally; this one-document script explains it.
import { buildCutoffQuery, cutoffParameters, resolveCutoffTargets, cutoffTargetComponents, CUTOFF_METHODS } from './methods-cutoff.mjs';
import { cutoffIndexForCount } from './cutoff-definition.mjs';
import { cutoffQueryDefinition } from './cutoff-blend.mjs';
import { shadeDefinition, shadeIndexForCount } from './shade-definition.mjs';
import { hueDefinition, hueIndexForCount } from './hue-definition.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';
import { api, safeIndexName, validateSearchResponse } from './service.mjs';
import { qualityFactorFormula } from './quality-curve.mjs';

const SCRIPT = `
List terms = new ArrayList();
double reconstructed = 0.0;
for (def target : params.targets) {
  List components = new ArrayList();
  double totalContribution = 0.0;
  double totalCoverage = 0.0;
  double totalPhysical = 0.0;
  double totalMass = 0.0;
  boolean allPass = true;
  boolean anyPass = false;
  for (def source : target.components) {
    Map component = new HashMap(source);
    double coverage = ((Number)doc[(String)source.coverageField].value).doubleValue() / 10000.0;
    double quality = ((Number)doc[(String)source.qualityField].value).doubleValue();
    double physical = ((Number)doc[(String)source.physicalCoverageField].value).doubleValue() / 10000.0;
    double requested = ((Number)target.amount).doubleValue();
    double indexedTarget = Math.round(requested * 10000.0) / 10000.0;
    double delta = coverage - indexedTarget;
    double multiplier = delta > 0 ? (double)params.excessPenalty : 1.0;
    double areaFactor = params.mode == 'vibe' ? Math.pow(coverage, (double)params.areaPower) : Math.max(0.0, 1.0 - Math.abs(delta) * multiplier);
    double strength = params.mode == 'vibe' ? (double)params.qualityInfluence : requested > 0 ? (double)params.qualityPenalty * (double)params.qualityInfluence : 0.0;
    boolean applies = params.mode == 'vibe' || requested > 0;
    double qualityBase = !applies ? 1.0 : params.mode == 'vibe' ? quality : 1.0 - (double)params.qualityPenalty * (1.0 - quality);
    boolean powerCurve = params.qualityCurve == 'power';
    double qualityFactor = powerCurve ? Math.pow(qualityBase, (double)params.qualityInfluence) : Math.max(0.0, 1.0 - strength * (1.0 - quality));
    boolean passes = !applies || quality >= (double)params.effectiveMinimumQuality;
    double gate = passes ? 1.0 : 0.0;
    double componentWeight = ((Number)source.componentWeight).doubleValue();
    double weight = componentWeight / params.targets.size();
    double contribution = areaFactor * qualityFactor * gate * weight;
    component.putAll(['coverage': coverage, 'effectiveCoverage': coverage, 'physicalCoverage': physical,
      'conditionalQuality': quality, 'qualityMass': coverage * quality, 'indexedTarget': indexedTarget,
      'areaFactor': areaFactor, 'qualityFactor': qualityFactor, 'qualityStrength': powerCurve ? null : strength,
      'qualityCurve': params.qualityCurve, 'qualityBase': powerCurve ? qualityBase : null,
      'qualityExponent': powerCurve ? params.qualityInfluence : null,
      'qualityInfluence': params.qualityInfluence, 'minimumQuality': params.minimumQuality,
      'effectiveMinimumQuality': params.effectiveMinimumQuality, 'qualityThresholdApplies': applies,
      'passesMinimumQuality': passes, 'qualityGateFactor': gate, 'weight': weight,
      'scoreContribution': contribution, 'signedAreaError': params.mode == 'proportions' ? delta : null,
      'excessMultiplier': params.mode == 'proportions' ? multiplier : null]);
    components.add(component);
    totalContribution += contribution;
    totalCoverage += componentWeight * coverage;
    totalPhysical += componentWeight * physical;
    totalMass += componentWeight * coverage * quality;
    allPass = allPass && passes;
    anyPass = anyPass || passes;
  }
  Map term = new HashMap(target);
  if (components.size() == 1) term.putAll((Map)components.get(0));
  else term.putAll(['areaFactor': null, 'qualityFactor': null, 'qualityStrength': null, 'qualityBase': null, 'qualityExponent': null, 'qualityGateFactor': null,
    'indexedTarget': Math.round(((Number)target.amount).doubleValue() * 10000.0) / 10000.0,
    'signedAreaError': null, 'excessMultiplier': null]);
  term.putAll(['components': components, 'coverage': totalCoverage, 'effectiveCoverage': totalCoverage,
    'physicalCoverage': totalPhysical, 'conditionalQuality': components.size() == 1 ? components.get(0).conditionalQuality : totalCoverage > 0 ? totalMass / totalCoverage : 0.0,
    'qualityMass': totalMass, 'weight': 1.0 / params.targets.size(), 'scoreContribution': totalContribution,
    'qualityCurve': params.qualityCurve, 'qualityInfluence': params.qualityInfluence, 'minimumQuality': params.minimumQuality,
    'effectiveMinimumQuality': params.effectiveMinimumQuality,
    'qualityThresholdApplies': params.mode == 'vibe' || ((Number)target.amount).doubleValue() > 0,
    'passesMinimumQuality': allPass, 'anyComponentPassesMinimumQuality': anyPass,
    'summaryOnly': components.size() > 1]);
  terms.add(term);
  reconstructed += totalContribution;
}
List regions = new ArrayList();
int occupied = 0;
for (def sourceRegion : params.regions) {
  List components = new ArrayList();
  double totalCoverage = 0.0;
  double totalPhysical = 0.0;
  double totalMass = 0.0;
  for (def source : sourceRegion.components) {
    double coverage = ((Number)doc[(String)source.coverageField].value).doubleValue() / 10000.0;
    double quality = ((Number)doc[(String)source.qualityField].value).doubleValue();
    double physical = ((Number)doc[(String)source.physicalCoverageField].value).doubleValue() / 10000.0;
    double weight = ((Number)source.componentWeight).doubleValue();
    Map component = new HashMap(source);
    component.putAll(['coverage': coverage, 'effectiveCoverage': coverage, 'physicalCoverage': physical,
      'conditionalQuality': quality, 'qualityMass': coverage * quality]);
    components.add(component);
    totalCoverage += weight * coverage;
    totalPhysical += weight * physical;
    totalMass += weight * coverage * quality;
  }
  if (totalCoverage > 0) occupied++;
  regions.add(['index': sourceRegion.index, 'coverage': totalCoverage, 'effectiveCoverage': totalCoverage,
    'physicalCoverage': totalPhysical, 'conditionalQuality': components.size() == 1 ? components.get(0).conditionalQuality : totalCoverage > 0 ? totalMass / totalCoverage : 0.0,
    'qualityMass': totalMass, 'components': components, 'summaryOnly': components.size() > 1]);
}
return ['score': ['reconstructed': reconstructed, 'terms': terms], 'regions': regions,
  'totals': ['pixelCount': doc['overlap_pixel_total'].value, 'occupiedRegionCount': occupied]];
`;

function profileFor(method) {
  return CUTOFF_METHODS.find(candidate => candidate.id === (typeof method === 'string' ? method : method.id)).profile;
}

export function buildCutoffInspectionQuery({ method = 'cutoff-hard', id, query, parameters: supplied = {} }) {
  if (typeof id !== 'string' || !id.trim()) throw Error('A wallpaper ID is required.');
  const parameters = cutoffParameters(method, supplied);
  const { compiled, targets } = resolveCutoffTargets(method, query, { parameters });
  const profile = profileFor(method);
  const body = buildCutoffQuery({ method, query, limit: 1, filter: { ids: { values: [id] } }, parameters });
  body.script_fields = { cutoff_diagnostics: { script: { lang: 'painless', source: SCRIPT, params: {
    ...parameters, effectiveMinimumQuality: Math.fround(parameters.minimumQuality), mode: compiled.mode, targets,
    regions: overlapRegionsForCount(parameters.bucketCount).map(region => ({ index: region.index,
      components: cutoffTargetComponents(region, profile, parameters.pixelCutoff, parameters.cutoffBlendExponent) })),
  } } } };
  return body;
}

export async function inspectCutoff({ method = 'cutoff-hard', id, query, index, signal, parameters: supplied = {} }) {
  const parameters = cutoffParameters(method, supplied), profile = profileFor(method);
  const metric = CUTOFF_METHODS.find(candidate => candidate.id === (typeof method === 'string' ? method : method.id)).metric;
  const hue = metric === 'shade-hue-aware', shade = metric === 'shade-aware';
  const bank = overlapRegionsForCount(parameters.bucketCount);
  index ??= (hue ? hueIndexForCount : shade ? shadeIndexForCount : cutoffIndexForCount)(parameters.bucketCount);
  const body = buildCutoffInspectionQuery({ method, id, query, parameters });
  const result = await api(`${safeIndexName(index)}/_search?request_cache=false`, { method: 'POST', body, signal, timeoutMs: 30000 });
  const hits = validateSearchResponse(result.body);
  if (!hits.length) throw Error('Wallpaper not found or not eligible for this query.');
  if (hits.length !== 1 || hits[0].id !== id) throw Error('OpenSearch returned a different wallpaper for inspection.');
  const diagnostic = result.body.hits.hits[0].fields?.cutoff_diagnostics?.[0];
  if (!Number.isFinite(diagnostic?.score?.reconstructed) || !Array.isArray(diagnostic.score.terms) || diagnostic.regions?.length !== bank.length) throw Error('OpenSearch returned incomplete cutoff diagnostics.');
  const { compiled, targets, warnings } = resolveCutoffTargets(method, query, { parameters });
  const regions = bank.map((region, i) => {
    const measured = diagnostic.regions[i];
    if (measured.index !== region.index || !Number.isFinite(measured.coverage) || !Number.isFinite(measured.conditionalQuality)) throw Error('OpenSearch returned invalid cutoff region diagnostics.');
    return { ...region, ...measured, selectedBy: targets.filter(target => target.regionIndex === region.index).map(target => target.targetIndex) };
  });
  const area = compiled.mode === 'vibe' ? `coverage^${parameters.areaPower}` : 'max(0, 1 − |coverage − target| × excessMultiplier)';
  const quality = qualityFactorFormula(compiled.mode, parameters);
  const formula = `score = mean_targets(sum_components(componentWeight × ${area} × qualityFactor × qualityGate)); qualityFactor = ${quality}; qualityGate = 1 when quality ≥ float32(${parameters.minimumQuality}), otherwise 0${compiled.mode === 'proportions' ? '; zero amount targets always use qualityFactor = qualityGate = 1' : ''}. Each component is scored independently.`;
  return {
    schemaVersion: 1, method: typeof method === 'string' ? method : method.id, id, query,
    compiled: { mode: compiled.mode, targets: compiled.targets, remainder: compiled.remainder }, parameters,
    definition: (hue ? hueDefinition : shade ? shadeDefinition : cutoffQueryDefinition)({ bucketCount: parameters.bucketCount, profile, cutoff: parameters.pixelCutoff, cutoffBlendExponent: parameters.cutoffBlendExponent }),
    score: { actual: hits[0].score, ...diagnostic.score, difference: diagnostic.score.reconstructed - hits[0].score,
      formulaKind: compiled.mode, formula, qualityCurve: parameters.qualityCurve,
      description: 'OpenSearch computes the ranking and explanatory ledger. Consensus coverage and quality are display summaries; its components are scored independently before their weighted scores are summed. Small differences reflect float32 score rounding.' },
    totals: diagnostic.totals, regions, warnings,
    evidence: { engine: 'opensearch', index, serviceTookMs: result.body.took, httpMs: result.wallMs,
      computation: `${parameters.qualityCurve === 'power' ? 'OpenSearch ranking with a selectable power quality curve (Painless when needed)' : 'Native OpenSearch ranking'}; one selected-document Painless field explains all stored regions and cutoff components. No application candidate reranking.` },
  };
}
