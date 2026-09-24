// Standalone feedback adapter. Existing case records, registry and scoring stay
// unchanged. All candidates use the same real-image,10%-step comparison scope.
import { extname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { api, hash, safeIndexName } from './service.mjs';
import { createCandidate as createOriginalCandidate } from './adapter.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { searchFavoriteDocvalueUtilities } from './favorite-docvalue-fetch.mjs';
import { linkedStrictnessBank, linkedStrictnessMetadata, linkedStrictnessSelection,
  createLinkedStrictnessPlan, supportsLinkedStrictness } from './linked-strictness.mjs';

const realAsset = asset => asset.cohort !== 'controlled-fixture' && extname(asset.filename ?? '').toLowerCase() !== '.svg';
const requireValue = (condition, message) => { if (!condition) throw Error(message); };
let sourceFiles;
const readSources = async () => sourceFiles ??= Object.keys(await favoriteSourceSnapshot(import.meta.url));

export async function createCandidate({ config, context }, dependencies = {}) {
  requireValue(['original', 'linked'].includes(config.variant), 'Choose original or linked feedback variant.');
  // The shared harness normalizes an omitted parameter bag to {}.
  requireValue(config.parameters === undefined || (config.parameters !== null && typeof config.parameters === 'object'
    && !Array.isArray(config.parameters) && Object.keys(config.parameters).length === 0),
  'Feedback uses the selected linked pair; parameter overrides are unsupported.');
  const bank = linkedStrictnessBank(config.bankId), selection = { bankId: bank.id, stepIndex: config.stepIndex };
  const parameters = linkedStrictnessSelection(selection), original = config.variant === 'original';
  const index = safeIndexName(config.index ?? (original ? 'color-exploration-shade-hue-256-real-v1' : bank.index));
  const ids = context.corpus.map(asset => asset.id), fixtures = context.corpus.filter(asset => !realAsset(asset)).map(asset => asset.id);
  const realIds = new Set(context.corpus.filter(realAsset).map(asset => asset.id));
  requireValue(new Set(ids).size === ids.length, 'Feedback corpus contains duplicate IDs.');
  const backend = dependencies.api ?? api, searchService = dependencies.searchService ?? searchFavoriteDocvalueUtilities;
  const parent = original ? await (dependencies.createOriginal ?? createOriginalCandidate)({ config: {
    ...config, method: 'cutoff-shade-hue-all-levels', index, parameters,
  }, context }) : null;
  const withExclusions = caseData => ({ ...caseData, excludedIds: [...new Set([...fixtures, ...(caseData.excludedIds ?? [])])] });
  const supports = caseData => {
    if (caseData.inputKind === 'controlled-fixture') return { supported: false, reason: 'Controlled-fixture judgments are outside this real-wallpaper comparison.' };
    const support = supportsLinkedStrictness({ ...selection, ...withExclusions(caseData) });
    if (!support.supported) return { ...support, reason: original
      ? 'Shared comparison query scope: ' + support.reason + ' The original UI retains its broader controls.' : support.reason };
    return original ? parent.supports(withExclusions(caseData)) : support;
  };
  const realScope = { searchableRealCount: realIds.size, excludedFixtureCount: fixtures.length, realImagesOnly: true,
    comparisonScope: 'Original and linked candidates both omit controlled-fixture cases and non10%-step requests; original UI support is not reduced.' };
  return {
    metadata: { id: config.id, method: original ? 'cutoff-shade-hue-all-levels' : 'linked-strictness',
      label: config.label ?? `${original ? 'Original reference' : bank.label}: ${bank.steps[config.stepIndex].label}`,
      variant: config.variant, bankId: bank.id, stepIndex: config.stepIndex, parameters,
      sourceFiles: await (dependencies.sourceFiles ?? readSources)(), ...realScope,
      execution: { kind: 'opensearch', retrieval: 'exact-stored-objective', index },
      limitations: ['Single-observer development judgments; no new labels or held-out accuracy claim.',
        'Only shared real-image cases at10% proportions are assessed; unsupported records remain in the run.',
        'Utility grouping can change very close float32 ties relative to the original. Real-corpus timings are not million-record capacity.'] },
    supports,
    async prepare() {
      if (original) return { ...await parent.prepare(), ...realScope };
      const [version, count, mapping, settings, documents, jvm] = await Promise.all([
        backend(''), backend(index + '/_count'), backend(index + '/_mapping'), backend(index + '/_settings'),
        backend(index + '/_mget?_source=false', { method: 'POST', body: { ids } }),
        backend('_nodes/jvm?filter_path=nodes.*.jvm.mem.heap_max_in_bytes'),
      ]);
      const actual = mapping.body[index]?.mappings, meta = actual?._meta, indexSettings = settings.body[index]?.settings?.index;
      requireValue(count.body.count === ids.length && !count.body._shards?.failed && documents.body.docs?.length === ids.length,
        'Linked feedback requires the complete indexed corpus.');
      const found = new Set(documents.body.docs.filter(doc => doc.found && !doc.error).map(doc => doc._id));
      requireValue(found.size === ids.length && ids.every(id => found.has(id)), 'Linked feedback corpus IDs differ.');
      requireValue(indexSettings?.uuid && meta?.experiment === 'strict-hue-favorite-utilities' && meta.utilityDefinitionVersion === 2
        && meta.mode === 'real' && meta.scope === 'full' && meta.count === ids.length && meta.presets === 'linked'
        && meta.numericPoints === true && meta.encodings?.includes('numeric') && meta.identityHash && meta.planHash
        && meta.utilities === bank.utilityCount && isDeepStrictEqual(meta.linkedStrictness, linkedStrictnessMetadata(bank.id)),
      'Linked feedback index metadata or preset path differs.');
      requireValue(actual._source?.enabled === false && actual.properties?.id?.type === 'keyword' && actual.properties.id.doc_values !== false,
        'Linked feedback requires disabled source and keyword ID doc values.');
      const keys = new Set(createLinkedStrictnessPlan(bank.id).descriptors.map(descriptor => descriptor.key));
      const fields = Object.entries(actual.properties?.utilities?.properties ?? {});
      requireValue(fields.length === keys.size && fields.every(([key, field]) => keys.has(key) && field.type === 'float'
        && field.index !== false && field.doc_values !== false), 'Linked feedback requires every compact float point and doc-value field.');
      return { index, count: count.body.count, indexUuid: indexSettings.uuid, completeIdsVerified: true, utilityFields: fields.length,
        mappingHash: hash(actual), indexMetadata: meta, ...realScope,
        execution: { kind: 'opensearch', index, version: version.body.version.number, retrieval: 'exact-stored-objective',
          topology: { nodes: Object.keys(jvm.body.nodes ?? {}).length, primaryShards: Number(indexSettings.number_of_shards),
            jvmHeapMaxBytes: Object.values(jvm.body.nodes ?? {}).map(node => node.jvm.mem.heap_max_in_bytes) },
          boundary: 'query compilation + HTTP + OpenSearch filtering/ranking + response decoding' } };
    },
    async search({ caseData, limit, signal }) {
      const support = supports(caseData);
      requireValue(support.supported, support.reason);
      const selected = withExclusions(caseData);
      const result = original ? await parent.search({ caseData: selected, limit, signal }) : await searchService({ index,
        method: 'favorite-utility-numeric-docvalues', query: caseData.query, parameters, limit, signal,
        eligibleIds: selected.eligibleIds, excludedIds: selected.excludedIds }, { request: backend });
      requireValue(result.hits.every(hit => realIds.has(hit.id)), 'Search returned an ineligible fixture or unknown image; results were not application-filtered.');
      return { ...result, evidence: { ...result.evidence, engine: 'opensearch', variant: config.variant, bankId: bank.id,
        stepIndex: config.stepIndex, parameters, realImagesOnly: true, excludedFixtureCount: fixtures.length } };
    },
  };
}
