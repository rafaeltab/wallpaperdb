// Separate experiment; preserved parent adapters and scorers remain unchanged.
import { createCandidate as createParentCandidate } from './favorite-docvalue-adapter.mjs';
import { FAVORITE_MULTIPLICITY_METHODS, searchFavoriteMultiplicity } from './favorite-multiplicity-utilities.mjs';
import { api, safeIndexName } from './service.mjs';

// Only the scalar variant is offered to the feedback/UI experiment initially.
export const METHODS = Object.freeze(FAVORITE_MULTIPLICITY_METHODS.filter(method => method.id === 'favorite-utility-numeric-multiplicity'));
export async function createCandidate({ config, context }, dependencies = {}) {
  const method = METHODS.find(method => method.id === (config.method ?? config.id));
  if (!method) throw Error('Unknown favorite multiplicity candidate: ' + (config.method ?? config.id));
  if (typeof config.index !== 'string' || !config.index) throw Error('Multiplicity refinement requires an explicit scratch index.');
  const index = safeIndexName(config.index);
  const parent = await createParentCandidate({ config: { ...config, method: method.parentMethod }, context }, dependencies);
  return {
    metadata: { ...parent.metadata, ...method, id: config.id ?? method.id, method: method.id, label: config.label ?? method.label,
      sourceFiles: [...new Set([...parent.metadata.sourceFiles, 'exploration/favorite-multiplicity-adapter.mjs', 'exploration/favorite-multiplicity-utilities.mjs'])],
      limitations: [...new Set([...parent.metadata.limitations, ...method.limitations])],
      execution: { ...parent.metadata.execution, duplicateTargets: 'Group identical complete utility fields using multiplicity / original target count; percentages stay separate.' } },
    supports: caseData => parent.supports(caseData),
    async prepare() { return { ...await parent.prepare(), parentMethod: method.parentMethod }; },
    async search({ caseData, limit, signal }) {
      const result = await searchFavoriteMultiplicity({ index, method, query: caseData.query, limit, parameters: config.parameters,
        eligibleIds: caseData.eligibleIds, excludedIds: caseData.excludedIds, signal }, { request: dependencies.request ?? dependencies.api ?? api });
      return { ...result, evidence: { ...result.evidence, engine: 'opensearch', method: method.id, approximate: false } };
    },
  };
}
