// THROWAWAY diagnostic viewer. Rankings use native OpenSearch functions.
// This one-document script only explains stored fields; it never reranks candidates.
import { buildOverlapQuery, overlapParameters, resolveOverlapTargets } from './methods-overlap.mjs';
import { OVERLAP_DEFINITION, OVERLAP_REGIONS, regionFields } from './overlap-regions.mjs';
import { OVERLAP_INDEX } from './overlap-index.mjs';
import { api, safeIndexName, validateSearchResponse } from './service.mjs';

const FORMULAS = {
  vibe: 'score = mean(coverageᵢ^0.5 × conditionalQualityᵢ)',
  proportions: 'score = mean(max(0, 1 − |coverageᵢ − targetᵢ| × excessMultiplierᵢ) × qualityFactorᵢ); qualityFactorᵢ = 1 − 0.35 × (1 − conditionalQualityᵢ), or 1 for a zero target',
};

const DIAGNOSTIC_SCRIPT = `
List terms = new ArrayList();
double reconstructed = 0.0;
for (int i = 0; i < params.targets.size(); i++) {
  Map target = params.targets.get(i);
  String coverageField = (String)target.coverageField;
  String qualityField = (String)target.qualityField;
  double coverage = ((Number)doc[coverageField].value).doubleValue() / 10000.0;
  double quality = ((Number)doc[qualityField].value).doubleValue();
  double requested = ((Number)target.amount).doubleValue();
  double indexedTarget = Math.round(requested * 10000.0) / 10000.0;
  double delta = coverage - indexedTarget;
  double multiplier = delta > 0 ? (double)params.excessPenalty : 1.0;
  double areaFactor;
  double qualityFactor;
  if (params.mode == 'vibe') {
    areaFactor = Math.pow(coverage, (double)params.areaPower);
    qualityFactor = quality;
  } else {
    areaFactor = Math.max(0.0, 1.0 - Math.abs(delta) * multiplier);
    qualityFactor = requested > 0 ? 1.0 - (double)params.qualityPenalty * (1.0 - quality) : 1.0;
  }
  double weight = 1.0 / params.targets.size();
  double contribution = areaFactor * qualityFactor * weight;
  reconstructed += contribution;
  Map term = new HashMap(target);
  term.put('coverage', coverage);
  term.put('conditionalQuality', quality);
  term.put('qualityMass', coverage * quality);
  term.put('areaFactor', areaFactor);
  term.put('qualityFactor', qualityFactor);
  term.put('weight', weight);
  term.put('scoreContribution', contribution);
  term.put('indexedTarget', indexedTarget);
  term.put('signedAreaError', params.mode == 'proportions' ? delta : null);
  term.put('excessMultiplier', params.mode == 'proportions' ? multiplier : null);
  terms.add(term);
}
List regions = new ArrayList();
int occupied = 0;
for (int i = 0; i < params.coverageFields.size(); i++) {
  String coverageField = (String)params.coverageFields.get(i);
  String qualityField = (String)params.qualityFields.get(i);
  double coverage = ((Number)doc[coverageField].value).doubleValue() / 10000.0;
  double quality = ((Number)doc[qualityField].value).doubleValue();
  if (coverage > 0) occupied++;
  regions.add(['index': i, 'coverage': coverage, 'conditionalQuality': quality, 'qualityMass': coverage * quality]);
}
return ['score': ['reconstructed': reconstructed, 'terms': terms], 'regions': regions,
  'totals': ['pixelCount': doc['overlap_pixel_total'].value, 'occupiedRegionCount': occupied]];
`;

export function buildOverlapInspectionQuery({ method = 'overlap-quality-dense', id, query, parameters: supplied = {} }) {
  if (typeof id !== 'string' || !id.trim()) throw Error('A wallpaper ID is required.');
  const { compiled, targets } = resolveOverlapTargets(method, query);
  const parameters = overlapParameters(method, supplied);
  const body = buildOverlapQuery({ method, query, limit: 1, filter: { ids: { values: [id] } }, parameters });
  body.script_fields = { overlap_diagnostics: { script: { lang: 'painless', source: DIAGNOSTIC_SCRIPT, params: {
    ...parameters, mode: compiled.mode, targets,
    coverageFields: OVERLAP_REGIONS.map(region => regionFields(region.index).coverage),
    qualityFields: OVERLAP_REGIONS.map(region => regionFields(region.index).quality),
  } } } };
  return body;
}

export async function inspectOverlap({ method = 'overlap-quality-dense', id, query, index = OVERLAP_INDEX, signal, parameters: supplied = {} }) {
  const body = buildOverlapInspectionQuery({ method, id, query, parameters: supplied });
  const result = await api(`${safeIndexName(index)}/_search?request_cache=false`, { method: 'POST', body, signal, timeoutMs: 30000 });
  const hits = validateSearchResponse(result.body);
  if (!hits.length) throw Error('Wallpaper not found or not eligible for this query.');
  if (hits.length !== 1 || hits[0].id !== id) throw Error('OpenSearch returned a different wallpaper for inspection.');
  const diagnostic = result.body.hits.hits[0].fields?.overlap_diagnostics?.[0];
  if (!Number.isFinite(diagnostic?.score?.reconstructed) || !Array.isArray(diagnostic.score.terms) || diagnostic.regions?.length !== OVERLAP_REGIONS.length) throw Error('OpenSearch returned incomplete overlapping-region diagnostics.');
  const { compiled, targets, warnings } = resolveOverlapTargets(method, query);
  const parameters = overlapParameters(method, supplied);
  const regions = OVERLAP_REGIONS.map((region, i) => {
    const measured = diagnostic.regions[i];
    if (measured.index !== region.index || !Number.isFinite(measured.coverage) || !Number.isFinite(measured.conditionalQuality)) throw Error('OpenSearch returned invalid region diagnostics.');
    return { ...region, ...measured, selectedBy: targets.filter(target => target.regionIndex === region.index).map(target => target.targetIndex) };
  });
  const formula = compiled.mode === 'vibe' ? FORMULAS.vibe.replace('^0.5', `^${parameters.areaPower}`) : FORMULAS.proportions.replace('0.35', String(parameters.qualityPenalty));
  return {
    schemaVersion: 1, method: typeof method === 'string' ? method : method.id, id, query,
    compiled: { mode: compiled.mode, targets: compiled.targets, remainder: compiled.remainder },
    parameters, definition: OVERLAP_DEFINITION,
    score: { actual: hits[0].score, ...diagnostic.score, difference: diagnostic.score.reconstructed - hits[0].score,
      formulaKind: compiled.mode, formula,
      description: 'OpenSearch computes the native score and the explanatory ledger. Small differences reflect float32 score rounding. Only selected target fields contribute; other regions are available for inspection.' },
    totals: diagnostic.totals, regions, warnings,
    evidence: { engine: 'opensearch', index, serviceTookMs: result.body.took, httpMs: result.wallMs,
      computation: 'Native OpenSearch ranking; one selected-document Painless field explains all measured regions and target terms. No application candidate reranking.' },
  };
}
