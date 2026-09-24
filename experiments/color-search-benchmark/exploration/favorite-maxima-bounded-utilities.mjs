// THROWAWAY exact refinement: retain the original OR bound and add necessary
// AND ranges derived from actual global maxima in the same PIT and filters.
// Every final score/order still comes from the unchanged OpenSearch query.
import { performance } from 'node:perf_hooks';
import { api, safeIndexName } from './service.mjs';
import { FAVORITE_BOUNDED_METHODS, supportsFavoriteBounded, favoriteBoundedThreshold,
  buildFavoriteBoundedQuery, buildFavoriteBoundedPlan } from './favorite-bounded-utilities.mjs';

export const FAVORITE_MAXIMA_BOUNDED_DEFINITION = Object.freeze({
  version: 1, parentMethod: 'favorite-utility-bounded',
  bounds: 'Original global OR bound plus inclusive per-field necessary AND ranges from global seed maxima.',
  floatSafety: 'Binary-search float32 values against outward-rounded products and final sum; retain every native winner and score tie.',
  duplicates: 'Repeated utility fields retain the original OR bound without additional maxima ranges.',
  scoring: 'Unchanged native numeric objective and globally eligible final ranking; no application reranking.',
});
export const FAVORITE_MAXIMA_BOUNDED_METHODS = Object.freeze([Object.freeze({
  ...FAVORITE_BOUNDED_METHODS[0], id: 'favorite-utility-maxima-bounded', parentMethod: 'favorite-utility-bounded',
  label: 'Favorite256: numeric utilities with global maxima bounds',
  family: 'favorite-maxima-bounded-utilities', searchKind: 'favorite-maxima-bounded-utilities',
  description: 'Exact numeric ranking with the original OR bound and necessary per-field ranges from global maxima in the same PIT.',
  limitations: [...FAVORITE_BOUNDED_METHODS[0].limitations,
    'Extra numeric intersections may cost more than they save; this separate prototype needs real scale measurements.',
    'Duplicate utility fields conservatively retain the original bound; existing duplicate-target score behavior is unchanged.'],
})]);
export const supportsFavoriteMaximaBounded = supportsFavoriteBounded;
export const buildFavoriteMaximaBoundedQuery = buildFavoriteBoundedQuery;
export function buildFavoriteMaximaBoundedPlan(options) {
  const plan = buildFavoriteBoundedPlan(options);
  return { ...plan, clauses: plan.numericBody.query.bool.should.map(term => ({ ...term.function_score.field_value_factor })) };
}

const bits = new DataView(new ArrayBuffer(4));
const floatFromBits = word => { bits.setUint32(0, word); return bits.getFloat32(0); };
const bitsFromFloat = value => { bits.setFloat32(0, value); return bits.getUint32(0); };
const nextFloat = value => value === 0 ? 2 ** -149 : floatFromBits(bitsFromFloat(value) + 1);

// Lucene multiplies float32 values/factors and sums the positive clause scores.
// Bound each product outward by one float32 ULP, sum in double, then round the
// final float32 outward too. For <=10 products, double addition error is much
// smaller than that final allowance. Missing field values use the same zero as
// the original scorer. Repeated fields fall back before this bound is applied.
function scoreUpperBound(clauses, values) {
  const sum = clauses.reduce((sum, clause) => sum + nextFloat(Math.fround(values[clause.field] * Math.fround(clause.factor))), 0);
  return nextFloat(Math.fround(sum));
}

export function favoriteMaximaNecessaryThresholds({ clauses, maxima, kthSeedScore }) {
  if (!Number.isFinite(kthSeedScore) || kthSeedScore < 0) throw Error('Seed lower bound must be finite and nonnegative.');
  if (!Array.isArray(clauses) || clauses.length < 1 || clauses.length > 10
    || clauses.some(clause => typeof clause.field !== 'string' || !clause.field || !Number.isFinite(clause.factor) || clause.factor <= 0)) throw Error('Maxima bounds require one to ten positive numeric clauses.');
  const fields = [...new Set(clauses.map(clause => clause.field))], normalized = {};
  for (const field of fields) {
    const value = maxima?.[field];
    if (!Number.isFinite(value) || value < 0 || value > 1) throw Error('Global maximum must be finite within0..1 for every field.');
    normalized[field] = Math.fround(value) || 0; // Canonical +0 keeps the bit-domain monotone.
  }
  const fallback = reason => ({ thresholds: [], fallback: reason });
  if (fields.length !== clauses.length) return fallback('duplicate-utility-fields');
  if (clauses.some(clause => clause.factor !== 1 / clauses.length)) return fallback('unsupported-clause-factors');
  const lower = Math.fround(kthSeedScore);
  if (lower === 0) return fallback('zero-lower-bound');
  if (scoreUpperBound(clauses, normalized) < lower) return fallback('inconsistent-maxima');
  const thresholds = [];
  for (const field of fields) {
    const values = { ...normalized, [field]: 0 };
    if (scoreUpperBound(clauses, values) >= lower) continue;
    let low = 0, high = bitsFromFloat(normalized[field]);
    while (low < high) {
      const mid = Math.floor((low + high) / 2); values[field] = floatFromBits(mid);
      if (scoreUpperBound(clauses, values) >= lower) high = mid;
      else low = mid + 1;
    }
    const threshold = floatFromBits(low);
    if (threshold > 0) thresholds.push({ field, threshold });
  }
  return { thresholds, fallback: null };
}

function searchHits(body, scored) {
  if (body.timed_out) throw Error('OpenSearch bounded stage timed out; partial hits rejected.');
  if (body._shards?.failed) throw Error('OpenSearch bounded stage has shard failures.');
  if (!Array.isArray(body.hits?.hits)) throw Error('OpenSearch bounded stage has no hit list.');
  const seen = new Set(); let previousUtility = Infinity;
  return body.hits.hits.map(hit => {
    const id = hit.fields?.id?.[0] ?? hit._id;
    if (typeof id !== 'string' || !id || seen.has(id)) throw Error('Invalid or duplicate bounded-stage document ID.');
    if (hit.fields?.id && hit.fields.id.length !== 1) throw Error('Expected exactly one document ID.');
    if (scored && (!Number.isFinite(hit._score) || hit._score < 0)) throw Error('Invalid bounded-stage score.');
    let utility;
    if (!scored) {
      if (!Array.isArray(hit.sort) || hit.sort.length !== 2 || hit.sort[1] !== id
        || !Number.isFinite(hit.sort[0]) || hit.sort[0] < 0 || hit.sort[0] > 1) throw Error('Invalid seed maximum or utility sort value.');
      utility = Math.fround(hit.sort[0]) || 0;
      if (utility > previousUtility) throw Error('Seed utility sort is not descending; global maximum is unverified.');
      previousUtility = utility;
    }
    seen.add(id); return { id, ...(scored ? { score: hit._score } : { utility }) };
  });
}

function serviceTimeoutMilliseconds(value) {
  if (value == null) return Infinity;
  const units = { nanos: 1e-6, micros: 1e-3, ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const match = typeof value === 'string' && /^(\d+)(nanos|micros|ms|s|m|h|d)$/.exec(value);
  const milliseconds = match ? Number(match[1]) * units[match[2]] : NaN;
  if (!Number.isFinite(milliseconds) || milliseconds < 1) throw Error('Bounded serviceTimeout must be a positive duration of at least 1ms.');
  return Math.floor(milliseconds);
}

export async function executeFavoriteMaximaBoundedUtilitySearch({ index, query, parameters = {}, limit = 20, eligibleIds, excludedIds, filter,
  signal, timeoutMs = 10000, serviceTimeout, request = api, now = () => performance.now() }) {
  safeIndexName(index);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000) throw Error('Bounded total timeout must be10..300000ms.');
  const stageServiceTimeoutMs = serviceTimeoutMilliseconds(serviceTimeout);
  const started = now(), deadline = started + timeoutMs, cleanupReserve = Math.min(100, timeoutMs * .1);
  const keepAliveSeconds = Math.max(60, Math.ceil(timeoutMs / 1000) + 5);
  const workDeadline = deadline - cleanupReserve;
  const plan = buildFavoriteMaximaBoundedPlan({ query, parameters, limit, eligibleIds, excludedIds, filter });
  const stages = [], pitIds = new Set();
  let pitId, result, failure;
  const globalBounds = { threshold: null, kthSeedScore: null, seedUnionCount: 0, targetCount: plan.targetCount,
    completeCandidateCoverage: true, consistency: 'point-in-time', fallback: null,
    maximaBounds: { maxima: {}, thresholds: [], addedRanges: 0, fallback: null } };
  const remaining = cleanup => {
    const value = Math.floor((cleanup ? deadline : workDeadline) - now());
    if (value < 1) throw Error('Bounded query exceeded its total client deadline.');
    return value;
  };
  const call = async (phase, route, options, cleanup = false) => {
    if (!cleanup) signal?.throwIfAborted();
    const budget = remaining(cleanup), stageStart = now();
    const response = await request(route, { ...options, timeoutMs: budget,
      signal: cleanup ? AbortSignal.timeout(budget) : signal ? AbortSignal.any([signal, AbortSignal.timeout(budget)]) : AbortSignal.timeout(budget) });
    // Capture even a late creation/rotation response before rejecting it, so the
    // finally path can still attempt deletion within the reserved total budget.
    if (typeof response.body.pit_id === 'string' && response.body.pit_id) { pitId = response.body.pit_id; pitIds.add(pitId); }
    stages.push({ phase, httpMs: response.wallMs ?? now() - stageStart, serviceTookMs: response.body.took ?? 0 });
    if (now() > (cleanup ? deadline : workDeadline)) throw Error('Bounded query exceeded its total client deadline.');
    return response.body;
  };
  const search = async (phase, body, scored) => {
    const budget = remaining(false);
    const response = await call(phase, '_search?request_cache=false', { method: 'POST', body: { ...body,
      _source: false, stored_fields: '_none_', docvalue_fields: ['id'], pit: { id: pitId },
      timeout: Math.min(stageServiceTimeoutMs, Math.max(1, budget - 1)) + 'ms' } });
    if (response.pit_id) { pitId = response.pit_id; pitIds.add(pitId); }
    return searchHits(response, scored);
  };
  try {
    const opened = await call('pit-open', index + '/_search/point_in_time?keep_alive=' + keepAliveSeconds + 's&allow_partial_pit_creation=false', { method: 'POST' });
    if (typeof opened.pit_id === 'string' && opened.pit_id) { pitId = opened.pit_id; pitIds.add(pitId); }
    if (!pitId || opened._shards?.failed) throw Error('Could not create a complete OpenSearch PIT.');
    const seedIds = new Set();
    for (const [ordinal, body] of plan.seedBodies.entries()) {
      const hits = await search('seed-' + ordinal, body, false);
      if (hits.length) globalBounds.maximaBounds.maxima[plan.fields[ordinal]] = hits[0].utility;
      for (const hit of hits) seedIds.add(hit.id);
    }
    globalBounds.seedUnionCount = seedIds.size;
    let finalBody = plan.numericBody;
    if (seedIds.size < limit) globalBounds.fallback = 'fewer-than-limit-seeds';
    else {
      const restricted = structuredClone(plan.numericBody);
      restricted.query.bool.filter.push({ ids: { values: [...seedIds] } });
      const seedScores = await search('seed-score', restricted, true);
      if (seedScores.length < limit) globalBounds.fallback = 'fewer-than-limit-seed-scores';
      else {
        globalBounds.kthSeedScore = seedScores[limit - 1].score;
        globalBounds.threshold = favoriteBoundedThreshold(globalBounds.kthSeedScore, plan.targetCount);
        if (globalBounds.threshold === null) globalBounds.fallback = 'zero-lower-bound';
        else {
          finalBody = structuredClone(plan.numericBody);
          finalBody.query.bool.filter.push({ bool: { should: plan.fields.map(field => ({ range: { [field]: { gte: globalBounds.threshold } } })), minimum_should_match: 1 } });
          const necessary = favoriteMaximaNecessaryThresholds({ clauses: plan.clauses,
            maxima: globalBounds.maximaBounds.maxima, kthSeedScore: globalBounds.kthSeedScore });
          Object.assign(globalBounds.maximaBounds, necessary);
          for (const { field, threshold } of necessary.thresholds) finalBody.query.bool.filter.push({ range: { [field]: { gte: threshold } } });
          globalBounds.maximaBounds.addedRanges = necessary.thresholds.length;
        }
      }
    }
    if (globalBounds.fallback) globalBounds.maximaBounds.fallback = globalBounds.fallback;
    result = await search('global-final', finalBody, true);
  } catch (error) { failure = error; }
  finally {
    if (pitIds.size) {
      try {
        const closed = await call('pit-close', '_search/point_in_time', { method: 'DELETE', body: { pit_id: [...pitIds] } }, true);
        if (!Array.isArray(closed.pits) || [...pitIds].some(id => !closed.pits.some(pit => pit.pit_id === id && pit.successful))) throw Error('OpenSearch PIT cleanup did not acknowledge every snapshot.');
      } catch (error) {
        stages.push({ phase: 'pit-close-error', error: error.message, expiresAfter: keepAliveSeconds + 's from PIT creation' });
        failure ??= error;
      }
    }
  }
  if (failure) { failure.evidence = { index, stages, globalBounds, elapsedMs: now() - started }; throw failure; }
  return { hits: result, evidence: { index, stages, globalBounds, serviceTookMs: stages.reduce((sum, row) => sum + (row.serviceTookMs ?? 0), 0),
    httpMs: now() - started, elapsedMs: now() - started, requestCount: stages.length } };
}
