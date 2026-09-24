import { METHODS, getMethod, supports, executeSearch } from './registry.mjs';
import { loadExpandedCorpus, INDEX } from './service.mjs';
import { renderFindings } from './summary.mjs';

export async function createBrowserProvider() {
  const corpus=await loadExpandedCorpus();
  const fixtureIds=corpus.filter(c=>c.filename.endsWith('.svg')).map(c=>c.id);
  return {
    methods: METHODS,
    corpus,
    description: 'Throwaway color-query experiments. Filtering, scores, and result order come from each method’s search service: OpenSearch or ClickHouse. Every method includes the original wallpapers and the complete supplied ZIP.',
    reportUrl: 'http://zerotwo:8224/latest',
    findingsUrl: '/findings',
    getFindingsHtml: async()=> (await renderFindings()).html,
    async search({ methodId, query, limit, signal, includeFixtures=false }) {
      const method = getMethod(methodId);
      const support = supports(method, query, {});
      if (!support.supported) return { supported: false, reason: support.reason ?? 'Unsupported query', hits: [], warnings: support.warnings };
      const result = await executeSearch({ index:INDEX,method,query,limit,signal,excludedIds:includeFixtures?undefined:fixtureIds });
      return { ...result, evidence: { ...result.evidence, engine: method.engine ?? 'opensearch', warnings: support.warnings, approximate: method.approximate ?? false } };
    },
  };
}
