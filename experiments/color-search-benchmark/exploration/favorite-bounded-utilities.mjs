// THROWAWAY exact global bound for the favorite's precomputed numeric objective.
// OpenSearch does every score and ranking. The client only derives a conservative
// threshold from service scores and coordinates searches in one PIT snapshot.
// PIT API: https://docs.opensearch.org/2.11/search-plugins/searching-data/point-in-time-api/
import { performance } from 'node:perf_hooks';
import { api, safeIndexName } from './service.mjs';
import { buildFavoriteUtilityQuery, supportsFavoriteUtilities, FAVORITE_UTILITY_METHODS } from './favorite-utilities.mjs';

const numeric = FAVORITE_UTILITY_METHODS.find(method => method.encoding === 'numeric');
export const FAVORITE_BOUNDED_METHODS = Object.freeze([Object.freeze({
  ...numeric, id: 'favorite-utility-bounded', label: 'Favorite256: globally bounded numeric utilities',
  family: 'favorite-bounded-utilities', searchKind: 'favorite-bounded-utilities', executionKind: 'multi-stage',
  description: 'Exact numeric utility ranking with a conservative global bound, computed through several OpenSearch requests in one PIT.',
  retrieval: 'Exact global ranking of the same precomputed numeric objective within a point-in-time snapshot',
  limitations: [...numeric.limitations, 'Requires numeric utility fields indexed as float points as well as doc values.',
    'Multiple service requests and PIT lifetime add cost; this is not an approximate shortlist reranker.'],
})]);

export function supportsFavoriteBounded(_method, query, options = {}) {
  return supportsFavoriteUtilities('favorite-utility-numeric', query, options);
}

const bits = new DataView(new ArrayBuffer(4));
const floatFromBits = word => { bits.setUint32(0, word); return bits.getFloat32(0); };
const bitsFromFloat = value => { bits.setFloat32(0, value); return bits.getUint32(0); };
const nextPositiveFloat = value => value === 0 ? 2 ** -149 : floatFromBits(bitsFromFloat(value) + 1);

// If every utility u_i <= x, monotonic nonnegative float operations bound every
// rounded product by this outward-rounded product. One extra float32 ULP per
// product also covers grouping of duplicate positive Boolean clauses. Sum in
// double, then round outward again. n<=10, so double multiplication error is far
// smaller than the extra float32 ULP. This deliberately overestimates the scorer.
function uniformScoreUpperBound(x, n) {
  if (x === 0) return 0;
  const productUpper = nextPositiveFloat(Math.fround(x * Math.fround(1 / n)));
  return nextPositiveFloat(Math.fround(n * productUpper));
}

export function favoriteBoundedThreshold(kthSeedScore, targetCount) {
  if (!Number.isFinite(kthSeedScore) || kthSeedScore < 0) throw Error('Seed lower bound must be finite and nonnegative.');
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 10) throw Error('Bound requires one to ten numeric targets.');
  // OpenSearch serializes scores as round-trippable float32 decimals. Restore
  // that value before comparing; the parsed JS double can be slightly larger.
  const lower = Math.fround(kthSeedScore);
  if (lower === 0 || lower > uniformScoreUpperBound(1, targetCount)) return null;
  let low = 0, high = bitsFromFloat(1);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (uniformScoreUpperBound(floatFromBits(mid), targetCount) >= lower) high = mid;
    else low = mid + 1;
  }
  const threshold = floatFromBits(low);
  // Every document with all u_i<threshold has u_i<=previousFloat(threshold),
  // hence native score<lower. OR u_i>=threshold retains all winners AND ties.
  return threshold > 0 ? threshold : null;
}

/** Metadata/compilation only: this is the unchanged unbounded numeric query.
 * The executor below must be used for actual bounded-method measurement. */
export function buildFavoriteBoundedQuery(options) {
  return buildFavoriteUtilityQuery({ ...options, method: 'favorite-utility-numeric' });
}

export function buildFavoriteBoundedPlan(options) {
  const numericBody = buildFavoriteBoundedQuery(options);
  const fields = [...new Set(numericBody.query.bool.should.map(term => term.function_score.field_value_factor.field))];
  const seedBodies = fields.map(field => ({ size: numericBody.size, _source: false, stored_fields: '_none_', docvalue_fields: ['id'],
    track_total_hits: false, track_scores: false, query: { bool: { filter: structuredClone(numericBody.query.bool.filter) } },
    sort: [{ [field]: { order: 'desc', missing: 0 } }, { id: 'asc' }] }));
  return { fields, targetCount: numericBody.query.bool.should.length, numericBody, seedBodies };
}

function searchHits(body, scored) {
  if (body.timed_out) throw Error('OpenSearch bounded stage timed out; partial hits rejected.');
  if (body._shards?.failed) throw Error('OpenSearch bounded stage has shard failures.');
  if (!Array.isArray(body.hits?.hits)) throw Error('OpenSearch bounded stage has no hit list.');
  const seen = new Set();
  return body.hits.hits.map(hit => {
    const id = hit.fields?.id?.[0] ?? hit._id;
    if (typeof id !== 'string' || !id || seen.has(id)) throw Error('Invalid or duplicate bounded-stage document ID.');
    if (hit.fields?.id && hit.fields.id.length !== 1) throw Error('Expected exactly one document ID.');
    if (scored && (!Number.isFinite(hit._score) || hit._score < 0)) throw Error('Invalid bounded-stage score.');
    seen.add(id); return { id, ...(scored ? { score: hit._score } : {}) };
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

export async function executeFavoriteBoundedUtilitySearch({ index, query, parameters = {}, limit = 20, eligibleIds, excludedIds, filter,
  signal, timeoutMs = 10000, serviceTimeout, request = api, now = () => performance.now() }) {
  safeIndexName(index);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000) throw Error('Bounded total timeout must be10..300000ms.');
  const stageServiceTimeoutMs = serviceTimeoutMilliseconds(serviceTimeout);
  const started = now(), deadline = started + timeoutMs, cleanupReserve = Math.min(100, timeoutMs * .1);
  const keepAliveSeconds = Math.max(60, Math.ceil(timeoutMs / 1000) + 5);
  const workDeadline = deadline - cleanupReserve;
  const plan = buildFavoriteBoundedPlan({ query, parameters, limit, eligibleIds, excludedIds, filter });
  const stages = [], pitIds = new Set();
  let pitId, result, failure;
  const globalBounds = { threshold: null, kthSeedScore: null, seedUnionCount: 0, targetCount: plan.targetCount,
    completeCandidateCoverage: true, consistency: 'point-in-time', fallback: null };
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
      for (const hit of await search('seed-' + ordinal, body, false)) seedIds.add(hit.id);
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
        }
      }
    }
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
