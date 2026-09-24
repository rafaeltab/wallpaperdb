import { getMethod, supports, executeSearch } from './registry.mjs';
import { loadExpandedCorpus, INDEX } from './service.mjs';
import { inspectOverlap } from './overlap-diagnostics.mjs';

export async function createOverlapInspectorProvider() {
  const corpus = await loadExpandedCorpus();
  const fixtureIds = corpus.filter(asset => asset.cohort === 'controlled-fixture' || asset.filename.endsWith('.svg')).map(asset => asset.id);
  const methods = ['overlap-quality-dense', 'overlap-quality-hybrid'].map(getMethod);
  return {
    corpus, methods,
    async search({ method: methodId, query, limit, includeFixtures, signal }) {
      const method = getMethod(methodId);
      const check = supports(method, query);
      if (!check.supported) return { supported: false, reason: check.reason, warnings: check.warnings, hits: [] };
      const result = await executeSearch({ index: INDEX, method, query, limit, excludedIds: includeFixtures ? undefined : fixtureIds, signal });
      return { ...result, supported: true, warnings: check.warnings, evidence: { ...result.evidence, engine: 'opensearch', warnings: check.warnings } };
    },
    inspect: inspectOverlap,
  };
}
