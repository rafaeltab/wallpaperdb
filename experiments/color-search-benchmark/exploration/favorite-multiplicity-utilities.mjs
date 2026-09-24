// SEPARATE THROWAWAY PROTOTYPE: query-only correction for duplicate resolved utility targets.
// No indexing changes, no document filtering/ranking in the application.
import { FAVORITE_DOCVALUE_FETCH_METHODS, buildFavoriteDocvalueQuery, decodeFavoriteDocvalueFetchResponse, supportsFavoriteDocvalueFetch } from './favorite-docvalue-fetch.mjs';
import { FAVORITE_BOUNDED_METHODS, buildFavoriteBoundedQuery, executeFavoriteBoundedUtilitySearch, supportsFavoriteBounded } from './favorite-bounded-utilities.mjs';
import { api, safeIndexName } from './service.mjs';

const parents = [FAVORITE_DOCVALUE_FETCH_METHODS.find(method => method.id === 'favorite-utility-numeric-docvalues'),
  FAVORITE_DOCVALUE_FETCH_METHODS.find(method => method.id === 'favorite-utility-sorted-docvalues'), FAVORITE_BOUNDED_METHODS[0]];
export const FAVORITE_MULTIPLICITY_METHODS = Object.freeze(parents.map(parent => Object.freeze({ ...parent,
  id: parent.id.replace('-docvalues', '') + '-multiplicity', parentMethod: parent.id,
  label: parent.label + ' · duplicate-target correction', searchKind: 'favorite-multiplicity',
  description: 'Group identical resolved utility fields and preserve their multiplicity inside the field factor. No new index.',
  limitations: [...parent.limitations, 'Corrects the known duplicate-target score loss; intentionally differs from the preserved buggy score for those queries.',
    'Grouping changes float32 rounding versus an ideal ungrouped sum; distinct resolved targets retain the exact parent query.',
    ...(parent.id === 'favorite-utility-bounded' ? ['Duplicate targets use a complete unbounded OpenSearch query; the older pruning bound is used only for unchanged distinct-target queries.'] : [])],
})));
const methodFor = (input = FAVORITE_MULTIPLICITY_METHODS[0].id) => {
  const id = typeof input === 'string' ? input : input?.id;
  const method = FAVORITE_MULTIPLICITY_METHODS.find(method => method.id === id);
  if (!method) throw Error('Unknown multiplicity method: ' + id);
  return method;
};

/** Only accepts the exact numeric utility clause shape emitted by the parent.
 * Counts by complete field key, which includes anchor/name, amount and preset.
 * It does not combine requested percentages or normalize over unique colors. */
export function groupFavoriteUtilityTerms(body) {
  const terms = body?.query?.bool?.should;
  if (!Array.isArray(terms) || terms.length < 1 || terms.length > 10) throw Error('Expected one to ten numeric utility terms.');
  const groups = new Map(), count = terms.length;
  for (const term of terms) {
    const fs = term?.function_score, factor = fs?.field_value_factor;
    if (!fs || Object.keys(term).length !== 1 || Object.keys(fs).sort().join(',') !== 'boost_mode,field_value_factor,query'
      || JSON.stringify(fs.query) !== '{"match_all":{}}' || fs.boost_mode !== 'replace'
      || !factor || Object.keys(factor).sort().join(',') !== 'factor,field,missing,modifier'
      || typeof factor.field !== 'string' || !factor.field.startsWith('utilities.')
      || factor.factor !== 1 / count || factor.modifier !== 'none' || factor.missing !== 0) throw Error('Unsupported numeric utility clause; refusing a partial rewrite.');
    const group = groups.get(factor.field);
    if (group) group.count++;
    else groups.set(factor.field, { term, field: factor.field, count: 1 });
  }
  const evidence = { targetCount: count, distinctUtilityCount: groups.size, corrected: groups.size !== count,
    groups: [...groups.values()].map(({ field, count: multiplicity }) => ({ field, multiplicity, factor: multiplicity / count })) };
  if (!evidence.corrected) return { body, evidence };
  const should = [...groups.values()].map(({ term, count: multiplicity }) => ({ function_score: { ...term.function_score,
    field_value_factor: { ...term.function_score.field_value_factor, factor: multiplicity / count } } }));
  return { body: { ...body, query: { ...body.query, bool: { ...body.query.bool, should } } }, evidence };
}

export function supportsFavoriteMultiplicity(input, query, options = {}) {
  const method = methodFor(input);
  return method.parentMethod === 'favorite-utility-bounded' ? supportsFavoriteBounded(method.parentMethod, query, options)
    : supportsFavoriteDocvalueFetch(method.parentMethod, query, options);
}

export function buildFavoriteMultiplicityQuery({ method: input, ...options } = {}) {
  const method = methodFor(input);
  const body = method.parentMethod === 'favorite-utility-bounded' ? buildFavoriteBoundedQuery(options)
    : buildFavoriteDocvalueQuery({ ...options, method: method.parentMethod });
  return groupFavoriteUtilityTerms(body).body;
}

export async function searchFavoriteMultiplicity({ method: input, index, signal, timeoutMs = 10000, serviceTimeout, ...options },
  { request = api, boundedSearch = executeFavoriteBoundedUtilitySearch } = {}) {
  const method = methodFor(input); safeIndexName(index); signal?.throwIfAborted();
  const parentBody = method.parentMethod === 'favorite-utility-bounded' ? buildFavoriteBoundedQuery(options)
    : buildFavoriteDocvalueQuery({ ...options, method: method.parentMethod });
  const { body: grouped, evidence: multiplicity } = groupFavoriteUtilityTerms(parentBody);
  if (method.parentMethod === 'favorite-utility-bounded' && !multiplicity.corrected) {
    const result = await boundedSearch({ ...options, index, signal, timeoutMs, serviceTimeout, request });
    return { ...result, evidence: { ...result.evidence, multiplicity } };
  }
  const body = { ...grouped, _source: false, stored_fields: '_none_', docvalue_fields: ['id'],
    ...(serviceTimeout == null ? {} : { timeout: serviceTimeout }) };
  const response = await request(`${index}/_search?request_cache=false`, { method: 'POST', body, signal, timeoutMs });
  const scoreSource = body.track_scores === false ? 'opensearch-sort-value' : 'opensearch-score';
  return { hits: decodeFavoriteDocvalueFetchResponse(response.body, { index, scoreSource }), totalEligible: response.body.hits.total?.value,
    evidence: { index, parentMethod: method.parentMethod, multiplicity, scoreSource, serviceTookMs: response.body.took,
      httpMs: response.wallMs, requestCount: 1, execution: 'Complete OpenSearch query; no application ranking.',
      ...(method.parentMethod === 'favorite-utility-bounded' ? { globalBounds: { completeCandidateCoverage: true,
        fallback: 'duplicate-targets-global-query', threshold: null, consistency: 'single-service-query' } } : {}) } };
}
