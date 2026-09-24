import { getMethod, supports, executeSearch } from './registry.mjs';
import { loadExpandedCorpus, INDEX } from './service.mjs';
import { inspectOverlap } from './overlap-diagnostics.mjs';
import { overlapParameters } from './methods-overlap.mjs';
import { overlapRegionColors } from './overlap-region-colors.mjs';
import { CUTOFF_METHODS, cutoffParameters } from './methods-cutoff.mjs';
import { inspectCutoff } from './cutoff-diagnostics.mjs';
import { cutoffRegionColors } from './cutoff-region-colors.mjs';

export async function createOverlapInspectorProvider() {
  const corpus = await loadExpandedCorpus();
  const fixtureIds = corpus.filter(asset => asset.cohort === 'controlled-fixture' || asset.filename.endsWith('.svg')).map(asset => asset.id);
  const methods = ['overlap-quality-dense', 'overlap-quality-hybrid', ...CUTOFF_METHODS.map(method => method.id)].map(getMethod);
  return {
    corpus, methods,
    async search({ method: methodId, query, parameters: supplied = {}, limit, signal }) {
      const method = getMethod(methodId);
      const parameters = method.searchKind === 'cutoff' ? cutoffParameters(method, supplied) : overlapParameters(method, supplied);
      const check = supports(method, query, { parameters });
      if (!check.supported) return { supported: false, reason: check.reason, warnings: check.warnings, parameters, hits: [] };
      const result = await executeSearch({ index: INDEX, method, query, parameters, limit, excludedIds: fixtureIds, signal });
      return { ...result, parameters: result.parameters ?? parameters, supported: true, warnings: check.warnings, evidence: { ...result.evidence, engine: 'opensearch', warnings: check.warnings } };
    },
    inspect: args => getMethod(args.method).searchKind === 'cutoff' ? inspectCutoff(args) : inspectOverlap(args),
    regionColors: args => args.profile ? cutoffRegionColors(args) : overlapRegionColors(args),
  };
}
