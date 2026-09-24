// Standalone feedback adapter; the frozen registry and parent adapters stay intact.
import { createCandidate as createParentCandidate } from './adapter.mjs';
import { api, safeIndexName } from './service.mjs';
import { FAVORITE_DOCVALUE_FETCH_METHODS, favoriteDocvalueFetchMethod, searchFavoriteDocvalueUtilities } from './favorite-docvalue-fetch.mjs';

export const METHODS = FAVORITE_DOCVALUE_FETCH_METHODS;

export async function createCandidate({ config, context }, dependencies = {}) {
  const method = favoriteDocvalueFetchMethod(config.method ?? config.id);
  if (typeof config.index !== 'string' || !config.index) throw Error('The fetch refinement requires an explicit scratch index.');
  const index = safeIndexName(config.index), backend = dependencies.api ?? api;
  let inspectedMapping;
  const parent = await createParentCandidate({ config: { ...config, method: method.parentMethod }, context }, {
    ...dependencies,
    api: async (route, options) => {
      const result = await backend(route, options);
      if (route === `${index}/_mapping`) inspectedMapping = result.body[index]?.mappings;
      return result;
    },
  });
  return {
    metadata: {
      ...parent.metadata, ...method, id: config.id ?? method.id, method: method.id,
      label: config.label ?? method.label,
      sourceFiles: [...new Set([...parent.metadata.sourceFiles,
        'exploration/favorite-docvalue-adapter.mjs', 'exploration/favorite-docvalue-fetch.mjs'])],
      limitations: [...new Set([...parent.metadata.limitations, ...method.limitations])],
      execution: { ...parent.metadata.execution, fetch: 'keyword ID doc values; stored fields disabled' },
    },
    supports: caseData => parent.supports(caseData),
    async prepare() {
      inspectedMapping = undefined;
      const prepared = await parent.prepare(), id = inspectedMapping?.properties?.id;
      if (id?.type !== 'keyword' || id.doc_values === false) throw Error('Doc-value fetch requires an id keyword field with doc values.');
      return { ...prepared, parentMethod: method.parentMethod, idDocValuesVerified: true,
        execution: { ...prepared.execution, fetch: 'keyword ID doc values; stored fields disabled' } };
    },
    async search({ caseData, limit, signal }) {
      const result = await searchFavoriteDocvalueUtilities({ index, method, query: caseData.query, limit,
        eligibleIds: caseData.eligibleIds, excludedIds: caseData.excludedIds, parameters: config.parameters, signal },
      { request: dependencies.request ?? backend });
      return { ...result, evidence: { ...result.evidence, engine: 'opensearch', method: method.id,
        approximate: method.approximate ?? false } };
    },
  };
}
