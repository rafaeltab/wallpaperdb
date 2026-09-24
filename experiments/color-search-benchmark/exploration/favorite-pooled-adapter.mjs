// Standalone feedback integration. The registry and original bounded adapter
// stay unchanged; parent preparation still verifies the real numeric index.
import { createCandidate as createParentCandidate } from './adapter.mjs';
import { api, safeIndexName } from './service.mjs';
import { FAVORITE_POOLED_METHODS, FAVORITE_POOLED_DEFINITION,
  executeFavoritePooledUtilitySearch } from './favorite-pooled-utilities.mjs';

export const METHODS = FAVORITE_POOLED_METHODS;

export async function createCandidate({ config, context }, dependencies = {}) {
  const method = METHODS.find(method => method.id === (config.method ?? config.id));
  if (!method) throw Error('Unknown favorite pooled method: ' + (config.method ?? config.id));
  if (typeof config.index !== 'string' || !config.index) throw Error('The pooled refinement requires an explicit scratch index.');
  const index = safeIndexName(config.index), backend = dependencies.api ?? api;
  let inspectedMapping;
  const parent = await createParentCandidate({ config: { ...config, method: 'favorite-utility-bounded' }, context }, {
    ...dependencies,
    api: async (route, options) => {
      const result = await backend(route, options);
      if (route === index + '/_mapping') inspectedMapping = result.body[index]?.mappings;
      return result;
    },
  });
  return {
    metadata: {
      ...parent.metadata, ...method, id: config.id ?? method.id, method: method.id,
      label: config.label ?? method.label, transportDefinition: FAVORITE_POOLED_DEFINITION,
      sourceFiles: [...new Set([...parent.metadata.sourceFiles,
        'exploration/favorite-pooled-adapter.mjs', 'exploration/favorite-pooled-utilities.mjs',
        'exploration/favorite-pooled-delete.mjs', 'exploration/favorite-maxima-bounded-utilities.mjs'])],
      limitations: [...new Set([...parent.metadata.limitations, ...method.limitations])],
      execution: { ...parent.metadata.execution, transport: 'Pooled native HTTP PIT cleanup with no retries; parent query algorithm unchanged' },
    },
    supports: caseData => parent.supports(caseData),
    async prepare() {
      inspectedMapping = undefined;
      const prepared = await parent.prepare(), id = inspectedMapping?.properties?.id;
      if (id?.type !== 'keyword' || id.doc_values === false) throw Error('Pooled stages require an id keyword field with doc values.');
      return { ...prepared, parentMethod: method.parentMethod, idDocValuesVerified: true,
        transportDefinition: FAVORITE_POOLED_DEFINITION };
    },
    async search({ caseData, limit, signal }) {
      const result = await executeFavoritePooledUtilitySearch({ method: method.id, index, query: caseData.query, limit,
        eligibleIds: caseData.eligibleIds, excludedIds: caseData.excludedIds, parameters: config.parameters, signal,
        ...(dependencies.request ? { request: dependencies.request } : {}) });
      return { ...result, evidence: { ...result.evidence, engine: 'opensearch', method: method.id,
        parentMethod: method.parentMethod, approximate: false } };
    },
  };
}
