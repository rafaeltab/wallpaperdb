// DESIGN-STAGE, UNIMPORTED PROTOTYPE. Not exercised in the active campaign.
// Compile necessary k-of-n utility ranges; never score or rank wallpapers.
export const FAVORITE_CARDINALITY_BOUND_DEFINITION = Object.freeze({
  version: 1,
  status: 'unintegrated and unmeasured',
  objective: 'Unchanged native numeric utility score; only add proven necessary filter conditions.',
  safety: 'Exclude fewer-than-k matches only when every such native score has a strict upper bound below the kth seed score.',
  ties: 'Inclusive ranges and a strict exclusion certificate retain native score ties.',
  duplicates: 'No extra conditions for repeated utility fields or unsupported factors.',
  integration: 'Requires the same PIT, metadata filters, seed lower bound and observed global maxima as the final query.',
});

const storage = new DataView(new ArrayBuffer(4));
function floatBits(value) { storage.setFloat32(0, value); return storage.getUint32(0); }
function floatValue(bits) { storage.setUint32(0, bits); return storage.getFloat32(0); }
function nextFloat(value) { return value === 0 ? 2 ** -149 : floatValue(floatBits(value) + 1); }

// Same conservative arithmetic model as the existing maxima bound: positive
// float products, double accumulation, final float score. One outward float ULP
// per product and another on the final sum dominate double accumulation error
// for at most ten terms. No negative weights or duplicate rewrite are allowed.
function upperScore(clauses, values) {
  let sum = 0;
  for (let i = 0; i < clauses.length; i++) sum += nextFloat(Math.fround(values[i] * Math.fround(clauses[i].factor)));
  return nextFloat(Math.fround(sum));
}
function validate({ clauses, maxima, kthSeedScore, requiredCounts }) {
  if (!Number.isFinite(kthSeedScore) || kthSeedScore < 0 || !Number.isFinite(Math.fround(kthSeedScore))) throw Error('A finite nonnegative native seed score is required.');
  if (!Array.isArray(clauses) || clauses.length < 1 || clauses.length > 10 || clauses.some(clause =>
    typeof clause.field !== 'string' || !clause.field || !Number.isFinite(clause.factor) || clause.factor <= 0)) throw Error('One to ten positive numeric clauses are required.');
  const fields = clauses.map(clause => clause.field), values = fields.map(field => {
    const value = maxima?.[field];
    if (!Number.isFinite(value) || value < 0 || value > 1) throw Error('Every field needs its eligible global maximum in0..1.');
    return Math.fround(value) || 0;
  });
  const counts = requiredCounts ?? Array.from({ length: Math.max(0, clauses.length - 1) }, (_, i) => i + 2);
  if (!Array.isArray(counts) || new Set(counts).size !== counts.length || counts.some(k => !Number.isInteger(k) || k < 1 || k > clauses.length)) throw Error('Required counts must be distinct integers in1..targetCount.');
  return { fields, values, counts: [...counts].sort((a, b) => a - b), lower: Math.fround(kthSeedScore) || 0 };
}
function exceptionSets(n, count) {
  const sets = [];
  const visit = (start, chosen) => {
    if (chosen.length === count) { sets.push([...chosen]); return; }
    for (let i = start; i <= n - (count - chosen.length); i++) { chosen.push(i); visit(i + 1, chosen); chosen.pop(); }
  };
  visit(0, []); return sets;
}
function excludedUpperBound(clauses, maxima, exceptions, thresholdBits) {
  // A rejected document has at most k-1 fields >= the inclusive cutoff.
  // All remaining stored float values are <= predecessor(cutoff). Giving any
  // k-1 exceptions their full maxima can only increase their possible score.
  const predecessor = floatValue(thresholdBits - 1), caps = maxima.map(maximum => Math.min(maximum, predecessor));
  let upper = 0;
  for (const free of exceptions) {
    const values = [...caps];
    for (const index of free) values[index] = maxima[index];
    upper = Math.max(upper, upperScore(clauses, values));
  }
  return upper;
}

/** Algebraic compiler only. Maxima/lower bound must be obtained by OpenSearch
 * within one PIT and identical eligibility. The caller still performs the
 * original global numeric scoring query; these are optional necessary filters. */
export function favoriteCardinalityNecessaryThresholds(options) {
  const { clauses } = options, { fields, values, counts, lower } = validate(options);
  const fallback = reason => ({ conditions: [], fallback: reason });
  if (new Set(fields).size !== fields.length) return fallback('duplicate-utility-fields');
  if (clauses.some(clause => clause.factor !== 1 / clauses.length || (clause.modifier !== undefined && clause.modifier !== 'none')
    || (clause.missing !== undefined && clause.missing !== 0))) return fallback('unsupported-clause-semantics');
  if (lower === 0) return fallback('zero-lower-bound');
  if (upperScore(clauses, values) < lower) return fallback('inconsistent-maxima');
  const conditions = [], largest = Math.max(...values), highBits = floatBits(largest) + 1;
  for (const minimumShouldMatch of counts) {
    const exceptions = exceptionSets(clauses.length, minimumShouldMatch - 1);
    const upperAt = bits => excludedUpperBound(clauses, values, exceptions, bits);
    if (upperAt(1) >= lower) continue; // Even zero-valued weak components cannot safely be excluded.
    // At nextFloat(maximum), all values lie below the cutoff; its excluded
    // upper bound is the global upper bound and must be >= the seed score.
    if (upperAt(highBits) < lower) return fallback('inconsistent-exclusion-envelope');
    let safe = 1, unsafe = highBits;
    while (safe + 1 < unsafe) {
      const midpoint = Math.floor((safe + unsafe) / 2);
      if (upperAt(midpoint) < lower) safe = midpoint; else unsafe = midpoint;
    }
    const threshold = floatValue(safe), excludedScoreUpperBound = upperAt(safe);
    conditions.push({ minimumShouldMatch, threshold, fields: [...fields],
      certificate: { nativeSeedLowerBound: lower, excludedScoreUpperBound,
        nextThreshold: floatValue(unsafe), nextExcludedScoreUpperBound: upperAt(unsafe), exceptionSetCount: exceptions.length } });
  }
  return { conditions, fallback: null };
}

/** Build only new filter clauses. Does not modify the score query, sort, PIT,
 * timeout, eligibility, HTTP transport, or any caller-owned object. */
export function favoriteCardinalityRangeFilters(compiled) {
  return compiled.conditions.map(condition => ({ bool: {
    should: condition.fields.map(field => ({ range: { [field]: { gte: condition.threshold } } })),
    minimum_should_match: condition.minimumShouldMatch,
  } }));
}
