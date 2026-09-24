// Query compilation only. The relative-accent score is executed in OpenSearch.
import { interpretQuery, metadataFilter } from './query.mjs';

export const RELATIVE_METHOD = Object.freeze({
  id: 'hybrid-relative-accents',
  label: 'Relative bright accents + named/precise color routing',
  family: 'relative-contrast', representation: 'hybrid-relative', searchKind: 'relative', approximate: false,
  fallbackNamed: 'feature-intent-bounded', fallbackCustom: 'palette-direct-precision',
  limitations: [
    'Dark-with-bright-spots queries use global relative-lightness statistics from 512×512 samples.',
    'Spot size, contrast, and darkness thresholds are hand-authored experimental heuristics, not trained preferences.',
    'The relative-accent branch scores every eligible document in OpenSearch; no capped candidate reranking is used.',
    'Other named queries use exact bounded feature scoring; picked colors/ranges use direct Palette32 precision scoring.',
  ],
});

export const RELATIVE_DEFAULTS = Object.freeze({ darkPower: 2, contrastScale: 0.4, minimumAccent: 0.01, preferredMaxAccent: 0.05, excessAccentScale: 0.15 });

export function isRelativeAccentQuery(query) {
  const compiled = interpretQuery(query);
  if (!compiled.supported || compiled.mode !== 'vibe' || compiled.customRanges) return false;
  if (compiled.special === 'dark_bright_accents') return true;
  const names = compiled.targets.map((target) => target.name);
  return names.length === 2 && names.includes('dark') && names.includes('bright');
}

export function supportsRelative(query) {
  const compiled = interpretQuery(query);
  if (!compiled.supported) return compiled;
  if (!isRelativeAccentQuery(query)) return { supported: false, reason: 'The relative-accent branch requires a dark vibe with bright spots; use the declared color fallback for other queries.' };
  return { supported: true, compiled, warnings: [...RELATIVE_METHOD.limitations] };
}

function validatedParameters(parameters = {}) {
  const values = { ...RELATIVE_DEFAULTS, ...parameters };
  for (const key of Object.keys(values)) if (!Object.hasOwn(RELATIVE_DEFAULTS, key)) throw new Error(`Unknown relative-accent parameter: ${key}`);
  for (const key of ['darkPower', 'contrastScale', 'minimumAccent', 'excessAccentScale']) if (!Number.isFinite(values[key]) || values[key] <= 0) throw new Error(`${key} must be finite and positive.`);
  if (!Number.isFinite(values.preferredMaxAccent) || values.preferredMaxAccent < 0 || values.preferredMaxAccent > 1 || values.minimumAccent > 1) throw new Error('Accent area fractions must be between zero and one.');
  return values;
}

export const RELATIVE_SCRIPT = `
double dark = doc['rel_dark_area50'].value;
double span = doc['rel_span_p999'].value;
double area = doc['rel_highlight_10_area'].value;
double darkPower = params.darkPower;
double contrastScale = params.contrastScale;
double minimumAccent = params.minimumAccent;
double preferredMaxAccent = params.preferredMaxAccent;
double excessAccentScale = params.excessAccentScale;
double contrast = Math.min(1.0, span / contrastScale);
double support = Math.min(1.0, area / minimumAccent);
double smallArea = Math.exp(-Math.max(0.0, area - preferredMaxAccent) / excessAccentScale);
return Math.pow(dark, darkPower) * contrast * support * smallArea;
`;

export function buildRelativeQuery({ query, limit = 20, eligibleIds, excludedIds, filter, parameters = {} }) {
  const support = supportsRelative(query);
  if (!support.supported) throw new Error(support.reason);
  return {
    size: limit, _source: false, track_total_hits: false,
    sort: [{ _score: 'desc' }, { id: 'asc' }],
    query: { script_score: {
      query: metadataFilter({ eligibleIds, excludedIds, filter, compiled: support.compiled }),
      script: { lang: 'painless', source: RELATIVE_SCRIPT, params: validatedParameters(parameters) },
    } },
  };
}

/** Offline arithmetic oracle for correctness checks only; never called by live search. */
export function relativeContrastReference(features, parameters = {}) {
  const p = validatedParameters(parameters);
  const area = features.rel_highlight_10_area;
  return features.rel_dark_area50 ** p.darkPower
    * Math.min(1, features.rel_span_p999 / p.contrastScale)
    * Math.min(1, area / p.minimumAccent)
    * Math.exp(-Math.max(0, area - p.preferredMaxAccent) / p.excessAccentScale);
}
