// Exact safe pruning: service scores the seed and service ranks the global final query.
// The application only turns the kth service score into necessary numeric bounds.
import { buildQuery, interpretQuery } from './methods.mjs';
import { searchIndex } from './service.mjs';

export const BOUNDED_METHOD = Object.freeze({
  id: 'feature-composition-bounded', label: 'Named composition with exact indexed bounds',
  family: 'composition-bounded', representation: 'named-features', approximate: false,
  scoring: 'composition', scalar: true, searchKind: 'bounded',
  limitations: [
    'Three service searches: cheap indexed seed, exact service seed score, globally bounded exact final score.',
    'No fixed candidate cap; weak bounds can still scan all metadata-matching documents.',
    'Shares the marginal-area union approximation of the feature composition reference.',
    'The multi-query exactness guarantee assumes a stable index; production needs a consistent snapshot/PIT or an equivalent versioned search view.',
  ],
});

/** Necessary per-feature bounds for scores >= threshold. Bounds deliberately round outwards. */
export function safeBounds(compiled, threshold, parameters = {}) {
  if (!Number.isFinite(threshold) || threshold <= 0) return [];
  const lowerScore = Math.max(0, threshold - 2e-6);
  if (!lowerScore) return [];
  const areaPower = parameters.areaPower ?? 0.65;
  const qualityPenalty = parameters.qualityPenalty ?? 0.35;
  const outsidePenalty = parameters.outsidePenalty ?? 6;
  const excessPenalty = parameters.excessPenalty ?? 1;
  if (!(areaPower > 0) || qualityPenalty < 0 || outsidePenalty < 0 || excessPenalty < 1) throw new Error('Exact bounds require positive areaPower, nonnegative penalties, and excessPenalty >= 1.');
  if (compiled.special) return []; // The normal search already uses the exact script for these intents.
  const n = compiled.targets.length;
  if (compiled.mode === 'vibe') {
    // mean(a_i^p * q_i) <= (a_j^p + n - 1)/n because every q_i <= 1.
    const required = Math.pow(Math.max(0, lowerScore * n - (n - 1)), 1 / areaPower);
    return compiled.targets.map(t => ({ range: { [`cov_${t.name}`]: { gte: Math.max(0, Math.floor(required * 10000) - 2) } } }));
  }
  // S=1/(1+E), E >= mean(abs(a_i-t_i)); therefore abs(a_i-t_i) <= n*(1/S-1).
  const maximumDeviation = n * Math.max(0, 1 / lowerScore - 1);
  return compiled.targets.map(t => ({ range: { [`cov_${t.name}`]: {
    gte: Math.max(0, Math.floor((t.amount - maximumDeviation) * 10000) - 2),
    lte: Math.min(10000, Math.ceil((t.amount + maximumDeviation) * 10000) + 2),
  } } }));
}

export async function searchBounded({ index, query, limit = 20, eligibleIds, excludedIds, filter, parameters = {}, signal, search = searchIndex }) {
  const compiled = interpretQuery(query);
  if (!compiled.supported) throw new Error(compiled.reason);
  const exact = { method: 'feature-composition-exact', query, limit, eligibleIds, excludedIds, filter, parameters };
  if (compiled.special) {
    const result = await search(index, buildQuery(exact), { signal });
    return { ...result, evidence: { ...result.evidence, strategy: 'exact-script-compound-intent', finalGloballyEligible: true, serviceSearches: 1 } };
  }
  const seedLimit = Math.min(10000, Math.max(limit, parameters.seedLimit ?? limit * 4));
  const seed = await search(index, buildQuery({ ...exact, method: 'native-area-linear', limit: seedLimit }), { signal });
  if (!seed.hits.length) return { ...seed, evidence: { ...seed.evidence, strategy: 'empty-indexed-seed', finalGloballyEligible: true, serviceSearches: 1 } };
  const seedFilter = [...(filter ? Array.isArray(filter) ? filter : [filter] : []), { ids: { values: seed.hits.map(hit => hit.id) } }];
  const scoredSeed = await search(index, buildQuery({ ...exact, filter: seedFilter }), { signal });
  if (seed.hits.length < seedLimit) {
    // Native seed returned fewer than its requested size, so it included every eligible document.
    return { ...scoredSeed, evidence: { ...scoredSeed.evidence, strategy: 'seed-covered-full-eligible-set', seedCount: seed.hits.length, finalGloballyEligible: true, serviceSearches: 2 } };
  }
  const threshold = scoredSeed.hits.at(-1)?.score ?? 0;
  const bounds = safeBounds(compiled, threshold, parameters);
  const finalFilter = [...(filter ? Array.isArray(filter) ? filter : [filter] : []), ...bounds];
  const result = await search(index, buildQuery({ ...exact, filter: finalFilter }), { signal });
  return { ...result, evidence: { ...result.evidence, strategy: 'exact-global-numeric-bounds', serviceSearches: 3,
    seedCount: seed.hits.length, threshold, bounds, seedServiceTookMs: seed.evidence?.serviceTookMs,
    scoreSeedServiceTookMs: scoredSeed.evidence?.serviceTookMs, finalGloballyEligible: true,
    guarantee: 'Any document capable of tying or beating the kth seed score passes necessary bounds; the final OpenSearch query searches that entire global set.' } };
}
