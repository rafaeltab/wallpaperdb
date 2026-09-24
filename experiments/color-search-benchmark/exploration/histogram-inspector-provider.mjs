import { getMethod, supports, executeSearch } from './registry.mjs';
import { loadExpandedCorpus, INDEX } from './service.mjs';
import { inspectHistogram, INSPECTOR_METHOD } from './histogram-inspector-diagnostics.mjs';

export async function createHistogramInspectorProvider() {
  const corpus = await loadExpandedCorpus();
  const fixtureIds = corpus.filter(asset => asset.cohort === 'controlled-fixture' || asset.filename.endsWith('.svg')).map(asset => asset.id);
  const method = getMethod(INSPECTOR_METHOD);
  return {
    corpus, method,
    async search({ query, limit, includeFixtures, signal }) {
      const check = supports(method, query);
      if (!check.supported) return { supported: false, reason: check.reason, warnings: check.warnings, hits: [] };
      const result = await executeSearch({ index: INDEX, method, query, limit, excludedIds: includeFixtures ? undefined : fixtureIds, signal });
      return { ...result, supported: true, warnings: check.warnings, evidence: { ...result.evidence, engine: 'opensearch', warnings: check.warnings } };
    },
    inspect: inspectHistogram,
  };
}
