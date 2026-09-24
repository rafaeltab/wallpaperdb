// THROWAWAY diagnostic viewer. OpenSearch computes the score and every removal effect.
// JavaScript compiles query weights and expands absent bins for presentation only.
import { HISTOGRAM_SCRIPT } from './methods.mjs';
import { buildFastQuery } from './methods-fast.mjs';
import { interpretQuery } from './query.mjs';
import { RGB4096_CENTERS } from './corpus-colors.mjs';
import { INDEX, api, safeIndexName, validateSearchResponse } from './service.mjs';

export const INSPECTOR_METHOD = 'histogram-intent-balanced';
const SCORE_MARKER = 'if (params.special';
// Embed the original scoring body verbatim: changing diagnostic prose cannot change it.
const SCORE = HISTOGRAM_SCRIPT.slice(HISTOGRAM_SCRIPT.indexOf(SCORE_MARKER));
const FORMULAS = {
  vibe: 'score = Σ(areaᵢ^0.65 × conditionalQualityᵢ × targetWeightᵢ)',
  proportions: 'score = 1 / (1 + meanAreaError + qualityPenalty + outsidePenalty)',
  gray_red_accents: 'score = max(0, grayscaleArea × redAccentFactor × (0.4 + 0.6 × redQuality) − outsidePenalty)',
  dark_bright_accents: 'score = max(0, darkArea × brightAccentFactor)',
};

function diagnosticScript(originalSource) {
  const gather = originalSource.slice(0, originalSource.indexOf(SCORE_MARKER));
  return `
double scoreHistogram(Map params, double[] areas, double[] masses, double union) {
  ${SCORE}
}
${gather}
double fullScore = scoreHistogram(params, areas, masses, union);
int targetCount = areas.length;
List conditionalQualities = new ArrayList();
List targetTerms = new ArrayList();
double meanAreaError = 0.0;
double qualityError = 0.0;
for (int j = 0; j < targetCount; j++) {
  double area = areas[j];
  double quality = area > 0 ? masses[j] / area : 0.0;
  conditionalQualities.add(quality);
  double target = (double)params.targets[j];
  double delta = area - target;
  double multiplier = delta > 0 ? (double)params.excessPenalty : 1.0;
  double areaErrorContribution = Math.abs(delta) * multiplier / targetCount;
  double targetQualityError = Math.min(area, target) * (1.0 - quality);
  meanAreaError += areaErrorContribution;
  qualityError += targetQualityError;
  double areaFactor = Math.pow(area, (double)params.areaPower);
  double targetWeight = target / (double)params.targetSum;
  Map term = new HashMap();
  term.put('index', j);
  term.put('area', area);
  term.put('qualityMass', masses[j]);
  term.put('conditionalQuality', quality);
  if (params.mode == 'proportions') {
    term.put('target', target);
    term.put('signedAreaError', delta);
    term.put('absoluteAreaError', Math.abs(delta));
    term.put('excessMultiplier', multiplier);
    term.put('areaErrorContribution', areaErrorContribution);
    term.put('matchedRequestedArea', Math.min(area, target));
    term.put('qualityError', targetQualityError);
    term.put('qualityPenaltyContribution', (double)params.qualityPenalty * targetQualityError);
  } else if (params.special == '') {
    term.put('areaFactor', areaFactor);
    term.put('targetWeight', targetWeight);
    term.put('scoreContribution', areaFactor * quality * targetWeight);
  }
  targetTerms.add(term);
}
double outside = Math.max(0.0, 1.0 - union);
Map terms = new HashMap();
terms.put('targets', targetTerms);
String formulaKind = params.mode;
if (params.special == 'gray_red_accents') {
  formulaKind = 'gray_red_accents';
  double red = areas[1];
  double redQuality = red > 0 ? masses[1] / red : 0.0;
  double accent = Math.min(1.0, red / 0.12) * Math.max(0.0, 1.0 - Math.max(0.0, red - 0.35) / 0.65);
  double qualityFactor = 0.4 + 0.6 * redQuality;
  double penalty = (double)params.outsidePenalty * outside;
  terms.put('grayscaleArea', areas[0]);
  terms.put('redArea', red);
  terms.put('redQuality', redQuality);
  terms.put('redAccentFactor', accent);
  terms.put('qualityFactor', qualityFactor);
  terms.put('outsidePenalty', penalty);
  terms.put('unclampedScore', areas[0] * accent * qualityFactor - penalty);
} else if (params.special == 'dark_bright_accents') {
  formulaKind = 'dark_bright_accents';
  double bright = areas[1];
  double accent = Math.min(1.0, bright / 0.03) * Math.max(0.0, 1.0 - Math.max(0.0, bright - 0.15) / 0.85);
  terms.put('darkArea', areas[0]);
  terms.put('brightArea', bright);
  terms.put('brightAccentFactor', accent);
  terms.put('unclampedScore', areas[0] * accent);
} else if (params.mode == 'proportions') {
  double penalty = (double)params.qualityPenalty * qualityError;
  double excessOutside = Math.max(0.0, 1.0 - union - (double)params.remainder);
  double outsidePenalty = (double)params.outsidePenalty * excessOutside;
  terms.put('meanAreaError', meanAreaError);
  terms.put('qualityError', qualityError);
  terms.put('qualityPenalty', penalty);
  terms.put('allowedRemainder', params.remainder);
  terms.put('excessOutsideArea', excessOutside);
  terms.put('outsidePenalty', outsidePenalty);
  terms.put('totalError', meanAreaError + penalty + outsidePenalty);
}
// Numeric doc values may contain duplicates. Sum entries into their original cell.
int[] counts = new int[4096];
for (int i = 0; i < histogram.size(); i++) {
  long packed = (long)histogram.get(i);
  int cell = (int)(packed / 65536L);
  counts[cell] += (int)(packed % 65536L);
}
List occupied = new ArrayList();
for (int cell = 0; cell < counts.length; cell++) {
  if (counts[cell] == 0) continue;
  double coverage = counts[cell] / total;
  double inUnion = 0.0;
  List contributions = new ArrayList();
  double[] remainingAreas = new double[targetCount];
  double[] remainingMasses = new double[targetCount];
  double remainingCoverage = (total - counts[cell]) / total;
  for (int j = 0; j < targetCount; j++) {
    double areaWeight = (double)((List)allWeights.get(j)).get(cell);
    double qualityWeight = (double)((List)allQualities.get(j)).get(cell);
    double areaContribution = coverage * areaWeight;
    double qualityMassContribution = coverage * qualityWeight;
    inUnion = Math.max(inUnion, areaWeight);
    contributions.add(['index': j, 'areaContribution': areaContribution, 'qualityMassContribution': qualityMassContribution]);
    if (remainingCoverage > 0) {
      remainingAreas[j] = Math.max(0.0, areas[j] - areaContribution) / remainingCoverage;
      remainingMasses[j] = Math.max(0.0, masses[j] - qualityMassContribution) / remainingCoverage;
    }
  }
  Map row = new HashMap();
  row.put('index', cell);
  row.put('count', counts[cell]);
  row.put('coverage', coverage);
  row.put('unionContribution', coverage * inUnion);
  row.put('targets', contributions);
  if (remainingCoverage > 0) {
    double remainingUnion = Math.max(0.0, union - coverage * inUnion) / remainingCoverage;
    double without = scoreHistogram(params, remainingAreas, remainingMasses, remainingUnion);
    row.put('scoreWithoutBin', without);
    row.put('leaveOneOutEffect', fullScore - without);
  } else {
    row.put('scoreWithoutBin', null);
    row.put('leaveOneOutEffect', null);
  }
  occupied.add(row);
}
return [
  'score': ['reconstructed': fullScore, 'formulaKind': formulaKind, 'terms': terms],
  'totals': ['pixelCount': total, 'occupiedBinCount': occupied.size(), 'targetAreas': areas, 'qualityMasses': masses, 'conditionalQualities': conditionalQualities, 'unionArea': union, 'outsideArea': outside],
  'occupied': occupied
];`;
}

/** Returns an ordinary score query plus a one-hit service-side diagnostic field. */
export function buildHistogramInspectionQuery({ id, query }) {
  if (typeof id !== 'string' || !id.trim()) throw Error('A wallpaper ID is required.');
  const compiled = interpretQuery(query);
  if (!compiled.supported) throw Error(compiled.reason);
  const parameters = { areaPower: .65, qualityPenalty: .1, excessPenalty: 1.5, outsidePenalty: compiled.remainder > 0 ? 0 : 6 };
  const body = buildFastQuery({ method: 'histogram-composition-typed', query, limit: 1, filter: { ids: { values: [id] } }, parameters });
  const script = body.query.script_score.script;
  body.script_fields = { histogram_diagnostics: { script: { lang: 'painless', source: diagnosticScript(script.source), params: script.params } } };
  return body;
}

export async function inspectHistogram({ id, query, signal, index = INDEX }) {
  const body = buildHistogramInspectionQuery({ id, query });
  const result = await api(`${safeIndexName(index)}/_search?request_cache=false`, { method: 'POST', body, signal, timeoutMs: 30000 });
  const hits = validateSearchResponse(result.body);
  if (!hits.length) throw Error('Wallpaper not found or not eligible for this query.');
  if (hits.length !== 1 || hits[0].id !== id) throw Error('OpenSearch returned a different wallpaper for inspection.');
  const diagnostic = result.body.hits.hits[0].fields?.histogram_diagnostics?.[0];
  if (!diagnostic?.totals || !Array.isArray(diagnostic.occupied) || !Number.isFinite(diagnostic.score?.reconstructed)) throw Error('OpenSearch returned incomplete histogram diagnostics.');
  const params = body.query.script_score.script.params;
  const occupied = new Map(diagnostic.occupied.map(bin => [bin.index, bin]));
  const bins = RGB4096_CENTERS.map((center, cell) => {
    const row = occupied.get(cell);
    const rgb = center.map(value => value * 255);
    const hex = `#${rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
    const unionWeight = Math.max(...params.weights.map(weights => weights[cell]));
    return {
      index: cell, rgb, hex, occupied: Boolean(row), count: row?.count ?? 0, coverage: row?.coverage ?? 0,
      unionWeight, unionContribution: row?.unionContribution ?? 0,
      targets: params.targets.map((_, target) => ({
        index: target, areaWeight: params.weights[target][cell], qualityWeight: params.qualities[target][cell],
        areaContribution: row?.targets[target].areaContribution ?? 0,
        qualityMassContribution: row?.targets[target].qualityMassContribution ?? 0,
      })),
      scoreWithoutBin: row ? row.scoreWithoutBin : diagnostic.score.reconstructed,
      leaveOneOutEffect: row ? row.leaveOneOutEffect : 0,
    };
  });
  const compiled = interpretQuery(query);
  return {
    schemaVersion: 1, method: INSPECTOR_METHOD, id, query,
    compiled: { mode: compiled.mode, special: compiled.special, targets: compiled.targets, remainder: compiled.remainder },
    parameters: { areaPower: params.areaPower, qualityPenalty: params.qualityPenalty, excessPenalty: params.excessPenalty, outsidePenalty: params.outsidePenalty },
    score: { actual: hits[0].score, ...diagnostic.score, difference: diagnostic.score.reconstructed - hits[0].score,
      formula: FORMULAS[diagnostic.score.formulaKind],
      description: diagnostic.score.formulaKind === 'dark_bright_accents' ? 'This accent formula uses dark and bright areas; conditional color quality does not affect its score.' : 'Conditional quality is quality mass divided by matching area (zero for an empty target). Target regions can overlap.',
    },
    totals: diagnostic.totals, bins,
    interpretation: {
      representation: '4096 fixed sRGB bins (16 per channel). Every sampled pixel in a bin uses the bin center for membership and quality.',
      qualityWeight: 'The scorer lookup already includes area membership; quality mass contribution is coverage × qualityWeight.',
      leaveOneOutEffect: 'Full score minus the score after removing this bin and renormalizing the remaining image to 100%. Positive supports the score; negative reduces it. Effects are nonadditive and must not be summed. Removing all image mass is undefined (null).',
      scoreDifference: 'Reconstructed double score minus OpenSearch float32 _score; small rounding differences are expected.',
    },
    evidence: { engine: 'opensearch', index, serviceTookMs: result.body.took, httpMs: result.wallMs, computation: 'Actual _score and all occupied-bin metrics/removal effects computed by OpenSearch; empty bins expanded for presentation.' },
  };
}
