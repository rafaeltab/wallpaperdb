// THROWAWAY PROTOTYPE. The selected curve executes within global OpenSearch scoring.
// Keep this source constant across colors and exponents so OpenSearch can reuse its
// compiled script. Coverage, gates and component weights remain native functions.
const POWER_QUALITY_SCRIPT = `
double quality = ((Number)doc[(String)params.field].value).doubleValue();
double base = 1.0 - (double)params.penalty * (1.0 - quality);
return Math.pow(Math.max(0.0, Math.min(1.0, base)), (double)params.exponent);
`;

function linearQualityFunctions(field, strength, directQuality) {
  if (strength === 0) return [];
  if (directQuality && strength === 1) return [{ field_value_factor: { field, modifier: 'none', missing: 0 } }];
  // Preserve the historical query byte-for-byte: max(0, 1-strength*(1-quality)).
  return [{ linear: { [field]: { origin: 1, scale: strength <= 1 ? .5 : .5 / strength,
    decay: strength <= 1 ? 1 - strength * .5 : .5, offset: 0 } } }];
}

export function qualityFunctions(field, parameters, mode) {
  const penalty = mode === 'vibe' ? 1 : parameters.qualityPenalty;
  const influence = parameters.qualityInfluence;
  if (parameters.qualityCurve === 'linear' || influence === 0 || influence === 1 || penalty === 0) {
    return linearQualityFunctions(field, penalty * influence, mode === 'vibe');
  }
  return [{ script_score: { script: { lang: 'painless', source: POWER_QUALITY_SCRIPT,
    params: { field, exponent: influence, penalty } } } }];
}

export function qualityFactorFormula(mode, parameters, qualitySymbol = 'conditionalQuality') {
  if (parameters.qualityCurve === 'power') return mode === 'vibe'
    ? `${qualitySymbol}^${parameters.qualityInfluence}`
    : `(1 − ${parameters.qualityPenalty} × (1 − ${qualitySymbol}))^${parameters.qualityInfluence}`;
  const strength = mode === 'vibe' ? parameters.qualityInfluence : `${parameters.qualityPenalty} × ${parameters.qualityInfluence}`;
  return `max(0, 1 − ${strength} × (1 − ${qualitySymbol}))`;
}
