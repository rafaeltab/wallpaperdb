// THROWAWAY fetch refinement. Parent query/score/sort remain unchanged.
// Fetch the existing keyword ID through doc values and skip all stored fields.
// OpenSearch still performs every filter and ranking; this decoder never reranks.
import { FAVORITE_UTILITY_METHODS, supportsFavoriteUtilities, buildFavoriteUtilityQuery } from './favorite-utilities.mjs';
import { FAVORITE_PRECISION_METHODS, supportsFavoritePrecision, buildFavoritePrecisionQuery } from './favorite-precision-utilities.mjs';
import { FAVORITE_SORTED_METHODS, supportsFavoriteSorted, buildFavoriteSortedQuery } from './favorite-sorted-utilities.mjs';
import { api, safeIndexName } from './service.mjs';

const parents = [
  FAVORITE_UTILITY_METHODS.find(method => method.id === 'favorite-utility-numeric'),
  FAVORITE_PRECISION_METHODS.find(method => method.id === 'favorite-utility-rank27'),
  FAVORITE_SORTED_METHODS.find(method => method.id === 'favorite-utility-sorted'),
];
export const FAVORITE_DOCVALUE_FETCH_METHODS = Object.freeze(parents.map(parent => Object.freeze({
  ...parent, id: parent.id + '-docvalues', parentMethod: parent.id,
  label: parent.label + ' · doc-value ID fetch', family: 'favorite-docvalue-fetch', searchKind: 'favorite-docvalue-fetch',
  description: parent.description + ' Fetch only the keyword ID from doc values, with stored fields disabled.',
  limitations: Object.freeze([...parent.limitations,
    'Fetch-only refinement: score calculations, eligible documents, sort and original precision limitations are unchanged.',
    'Requires the existing id keyword field to have doc values. It uses the same parent index; numeric sort still requires numeric points.',
    'Avoiding stored-field fetch may reduce fetch cost on source-disabled indexes. The benefit requires measurement; it is not a ranking change.']),
})));

export const FAVORITE_DOCVALUE_FETCH_DEFINITION = Object.freeze({
  version: 1, parentMethods: Object.freeze(parents.map(method => method.id)),
  fetch: Object.freeze({ stored_fields: '_none_', docvalue_fields: Object.freeze(['id']) }),
  scoring: 'The parent query and sort are unchanged. Normal paths return server _score; single-target fast numeric sort copies its first server sort value.',
  decoder: 'Require one nonempty string in fields.id and unique IDs; preserve every returned hit, exact score and service order.',
  evidenceBoundary: 'This controls fetch behavior only. Ranking fidelity and any latency improvement must be measured against the parent method.',
});

export function favoriteDocvalueFetchMethod(input = 'favorite-utility-numeric-docvalues') {
  const id = typeof input === 'string' ? input : input?.id;
  const method = FAVORITE_DOCVALUE_FETCH_METHODS.find(method => method.id === id);
  if (!method) throw Error('Unknown favorite doc-value fetch method: ' + id);
  return method;
}

export function supportsFavoriteDocvalueFetch(input, query, options = {}) {
  const method = favoriteDocvalueFetchMethod(input);
  const support = method.parentMethod === 'favorite-utility-sorted' ? supportsFavoriteSorted(method.parentMethod, query, options)
    : method.parentMethod === 'favorite-utility-rank27' ? supportsFavoritePrecision(method.parentMethod, query, options)
      : supportsFavoriteUtilities(method.parentMethod, query, options);
  return { ...support, warnings: [...(support.warnings ?? []), ...method.limitations] };
}

export function buildFavoriteDocvalueFetchQuery({ method: input = 'favorite-utility-numeric-docvalues', ...options } = {}) {
  const method = favoriteDocvalueFetchMethod(input);
  const parentOptions = { ...options, method: method.parentMethod };
  const body = method.parentMethod === 'favorite-utility-sorted' ? buildFavoriteSortedQuery(parentOptions)
    : method.parentMethod === 'favorite-utility-rank27' ? buildFavoritePrecisionQuery(parentOptions)
      : buildFavoriteUtilityQuery(parentOptions);
  return { ...body, stored_fields: '_none_', docvalue_fields: ['id'] };
}

/** Decode transport only: no score normalization, comparison or reordering. */
export function decodeFavoriteDocvalueFetchResponse(body, { index, scoreSource = 'opensearch-score' } = {}) {
  if (!['opensearch-score', 'opensearch-sort-value'].includes(scoreSource)) throw Error('Unknown doc-value score source.');
  if (body?.timed_out) throw Error('OpenSearch query timed out; partial hits rejected.');
  if (body?._shards?.failed) throw Error('OpenSearch shard failures; partial hits rejected.');
  if (!Array.isArray(body?.hits?.hits)) throw Error('OpenSearch returned an invalid hit list.');
  const seen = new Set();
  return body.hits.hits.map(hit => {
    const values = hit.fields?.id, id = values?.[0];
    if (!Array.isArray(values) || values.length !== 1 || typeof id !== 'string' || !id
      || seen.has(id) || (hit._id !== undefined && hit._id !== id) || (index && hit._index !== undefined && hit._index !== index)) {
      throw Error('OpenSearch returned a missing, ambiguous or duplicate doc-value ID.');
    }
    seen.add(id);
    let score = hit._score;
    if (scoreSource === 'opensearch-sort-value') {
      if (!Array.isArray(hit.sort) || hit.sort.length !== 2 || hit.sort[1] !== id) throw Error('OpenSearch returned ambiguous utility sort values.');
      score = hit.sort[0];
      if (score > 1) throw Error('OpenSearch returned an invalid utility sort score.');
    }
    if (!Number.isFinite(score) || score < 0) throw Error('OpenSearch returned an invalid score.');
    return { id, score };
  });
}

export async function searchFavoriteDocvalueFetch({ index, method: input = 'favorite-utility-numeric-docvalues', signal,
  timeoutMs = 10000, serviceTimeout, ...options }, { request = api } = {}) {
  safeIndexName(index);
  signal?.throwIfAborted();
  const method = favoriteDocvalueFetchMethod(input), body = buildFavoriteDocvalueFetchQuery({ ...options, method });
  if (serviceTimeout != null) body.timeout = serviceTimeout;
  const scoreSource = body.track_scores === false ? 'opensearch-sort-value' : 'opensearch-score';
  const result = await request(`${index}/_search?request_cache=false`, { method: 'POST', body, signal, timeoutMs });
  return { hits: decodeFavoriteDocvalueFetchResponse(result.body, { index, scoreSource }), totalEligible: result.body.hits.total?.value,
    evidence: { index, parentMethod: method.parentMethod, fetch: 'doc-value ID; stored_fields:_none_', scoreSource,
      serviceTookMs: result.body.took, httpMs: result.wallMs, totalRelation: result.body.hits.total?.relation,
      execution: 'Unchanged parent OpenSearch query and global sort; only ID fetch and response decoding differ. No application reranking.' } };
}

// Shared runner-facing names; the explicit fetch names remain useful for tests.
export const buildFavoriteDocvalueQuery = buildFavoriteDocvalueFetchQuery;
export const searchFavoriteDocvalueUtilities = searchFavoriteDocvalueFetch;
