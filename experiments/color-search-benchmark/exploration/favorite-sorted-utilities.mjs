// THROWAWAY execution refinement. OpenSearch performs the complete global sort;
// copying a returned sort value into the response score never changes hit order.
import { FAVORITE_UTILITY_METHODS, FAVORITE_UTILITY_DEFINITION, supportsFavoriteUtilities,
  buildFavoriteUtilityQuery, favoriteUtilityMapping, toFavoriteUtilityDocument } from './favorite-utilities.mjs';
import { api, searchIndex, safeIndexName, validateSearchResponse } from './service.mjs';

const numeric = FAVORITE_UTILITY_METHODS.find(method => method.encoding === 'numeric');
export const FAVORITE_SORTED_METHODS = Object.freeze([
  { id: 'favorite-utility-sorted', label: 'Favorite256: native numeric sort', trackScores: false,
    description: 'Sort one precomputed target utility directly using its numeric index. Copy the server sort value into the response score. Multiple targets retain the numeric score query.' },
  { id: 'favorite-utility-sorted-scored', label: 'Favorite256: native numeric sort with score tracking', trackScores: true,
    description: 'Control variant: the same numeric sort, with track_scores enabled and the original numeric scoring query retained. OpenSearch 2.11 score tracking adds a complete-score collector.' },
].map(method => Object.freeze({ ...method, encoding: 'numeric', family: 'favorite-sorted-utilities', searchKind: 'favorite-sorted-utilities',
  representation: 'favorite256-point-indexed-utilities', approximate: false, objectiveApproximation: false,
  retrieval: 'Exact global ordering by the stored float utility for one target; original global numeric score ordering for multiple targets',
  precision: 'Uses the same float32 precomputed utilities. Single-target order is unchanged from numeric utility score order, with id ascending for ties. Original five-layer grouping caveats remain.',
  limitations: Object.freeze([...numeric.limitations,
    'Requires a separate index with index:true and doc_values:true for every float utility; the existing doc-values-only mapping is not this experiment.',
    'Numeric sorting applies only to a single requested target. Multi-target queries use the unchanged numeric utility score query and gain no numeric-sort optimization.',
    method.trackScores
      ? 'OpenSearch 2.11 combines score tracking with a MaxScoreCollector using COMPLETE score mode. That prevents relying on numeric competitive-iterator skipping; this is the control, not the expected fast path.'
      : 'Single-target _score is not calculated. The adapter copies the first OpenSearch sort value into the result score without filtering, sorting, or reranking any returned hits.',
    'Point-based skipping is an engine optimization to measure, not a guaranteed speedup. Filtering, ties and segment layouts affect its benefit.',
  ]) })));

export const FAVORITE_SORTED_DEFINITION = Object.freeze({
  version: 1, parentUtilityDefinitionVersion: FAVORITE_UTILITY_DEFINITION.version,
  snapshot: 'strict-hue-favorite-001', utility: FAVORITE_UTILITY_DEFINITION.utility,
  mapping: 'Same scalar float32 utilities, indexed as numeric points and doc values, with stored source disabled.',
  singleTarget: 'Utility descending, missing value zero, then id ascending. Optional score tracking is a separately labeled control.',
  multipleTargets: 'Unchanged original numeric utility query and score sorting.',
  sources: Object.freeze([
    'https://docs.opensearch.org/2.11/search-plugins/searching-data/sort/',
    'https://github.com/opensearch-project/OpenSearch/blob/2.11.0/server/src/main/java/org/opensearch/search/query/TopDocsCollectorContext.java',
    'https://github.com/opensearch-project/OpenSearch/blob/2.11.0/server/src/main/java/org/opensearch/action/search/MaxScoreCollector.java',
    'https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/comparators/NumericComparator.java',
    'https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/MultiCollector.java',
  ]),
});

export function favoriteSortedMethod(input = 'favorite-utility-sorted') {
  const id = typeof input === 'string' ? input : input?.id;
  const method = FAVORITE_SORTED_METHODS.find(candidate => candidate.id === id);
  if (!method) throw Error('Unknown favorite numeric-sort method: ' + id);
  return method;
}
export function supportsFavoriteSorted(input, query, options = {}) {
  const method = favoriteSortedMethod(input), support = supportsFavoriteUtilities('favorite-utility-numeric', query, options);
  return { ...support, warnings: [...(support.warnings ?? []), ...method.limitations] };
}
export function favoriteSortedMapping(plan, { shards = 1 } = {}) {
  const mapping = favoriteUtilityMapping(plan, { source: false, shards, encodings: ['numeric'] });
  for (const field of Object.values(mapping.mappings.properties.utilities.properties)) field.index = true;
  return mapping;
}
export function toFavoriteSortedDocument(measurement, plan) {
  return toFavoriteUtilityDocument(measurement, plan, { encodings: ['numeric'] });
}
export function buildFavoriteSortedQuery({ method: input = 'favorite-utility-sorted', query, parameters = {}, ...options } = {}) {
  const method = favoriteSortedMethod(input), support = supportsFavoriteSorted(method, query, { ...options, parameters });
  if (!support.supported) throw Error(support.reason);
  const native = buildFavoriteUtilityQuery({ ...options, query, parameters, method: 'favorite-utility-numeric' });
  if (support.targets.length !== 1) return native;
  return { ...native, track_scores: method.trackScores,
    sort: [{ ['utilities.' + support.utilities[0].key]: { order: 'desc', missing: 0 } }, { id: 'asc' }] };
}

/** Normalize score transport only. Never compare or reorder the returned hits. */
export function decodeFavoriteSortedResponse(body) {
  if (body?.timed_out) throw Error('OpenSearch query timed out; partial hits rejected');
  if (body?._shards?.failed) throw Error('OpenSearch shard failures; partial hits rejected');
  if (!Array.isArray(body?.hits?.hits)) throw Error('OpenSearch returned invalid sorted hits');
  const scoredHits = body.hits.hits.map(hit => {
    const score = hit.sort?.[0];
    if (!Number.isFinite(score) || score < 0 || score > 1) throw Error('OpenSearch returned an invalid utility sort value');
    return { ...hit, _score: score };
  });
  return validateSearchResponse({ ...body, hits: { ...body.hits, hits: scoredHits } });
}

export async function searchFavoriteSortedUtilities({ index, signal, timeoutMs = 10000, serviceTimeout, ...options }, { request = api, search = searchIndex } = {}) {
  safeIndexName(index);
  const body = buildFavoriteSortedQuery(options);
  if (serviceTimeout != null) body.timeout = serviceTimeout;
  if (body.track_scores === false) {
    const result = await request(`${index}/_search?request_cache=false`, { method: 'POST', body, signal, timeoutMs });
    return { hits: decodeFavoriteSortedResponse(result.body), totalEligible: result.body.hits.total?.value,
      evidence: { index, serviceTookMs: result.body.took, httpMs: result.wallMs, totalRelation: result.body.hits.total?.relation,
        scoreSource: 'opensearch-sort-value', execution: 'global numeric field sort; first server sort value copied unchanged; no application reranking' } };
  }
  const result = await search(index, body, { signal, timeoutMs });
  return { ...result, evidence: { ...result.evidence, scoreSource: 'opensearch-score',
    execution: body.track_scores ? 'global numeric field sort with complete score tracking' : 'unchanged global numeric utility score query' } };
}
