// Query compilation is local; every candidate hit and score comes from its search service.
import { METHODS, getMethod, supports, executeSearch, indexForMethod } from './registry.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { api, INDEX, CORPUS_STORE, hash } from './service.mjs';
import { validateClickHouseReal } from './clickhouse-index.mjs';
import { CLICKHOUSE_REAL_TABLE } from './clickhouse-service.mjs';
import { validatePrecisionGridIndex } from './precision-grid-index.mjs';
import { verifyOverlapIndex } from './overlap-index.mjs';
import { verifyOverlapBucketIndex } from './overlap-bucket-index.mjs';
import { overlapParameters } from './methods-overlap.mjs';
import { cutoffParameters } from './methods-cutoff.mjs';
import { verifyCutoffIndex } from './cutoff-index.mjs';
import { verifyShadeIndex } from './shade-index.mjs';
import { verifyHueIndex } from './hue-index.mjs';

// Reuse expensive full-field verification only inside one feedback run, and only
// while OpenSearch's UUID and primary indexing counters are unchanged.
let cutoffVerificationRun;
const cutoffVerifications = new Map();
async function verifyCutoffForRun({ context, index, bucketCount, verify, backendApi, allowCache }) {
  const request = { index, bucketCount, expectedIds: context.corpus.map(asset => asset.id) };
  if (!allowCache || !context.runDirectory) return verify(request);
  if (cutoffVerificationRun !== context.runDirectory) { cutoffVerifications.clear(); cutoffVerificationRun = context.runDirectory; }
  const stats = await backendApi(`${index}/_stats/docs,indexing`);
  const snapshot = stats.body.indices?.[index];
  if (!snapshot?.uuid || !snapshot.primaries?.docs || !snapshot.primaries?.indexing) throw Error('Cannot verify cutoff index generation for this feedback run.');
  const generation = hash(JSON.stringify({ uuid: snapshot.uuid, docs: snapshot.primaries.docs, indexing: { index_total: snapshot.primaries.indexing.index_total, delete_total: snapshot.primaries.indexing.delete_total } }));
  const key = `${index}:${hash(JSON.stringify(request.expectedIds))}:${generation}`;
  if (!cutoffVerifications.has(key)) {
    const verified = await verify(request);
    cutoffVerifications.set(key, verified);
    return verified;
  }
  return { ...cutoffVerifications.get(key), verificationReusedWithinRun: true };
}
let descriptorHashes;
const descriptors=()=>descriptorHashes??=Promise.all(['features.jsonl','refinement-features.jsonl'].map(async name=>[name,hash(await readFile(path.join(CORPUS_STORE,name)))])).then(Object.fromEntries);

export async function createCandidate({ config, context }, dependencies = {}) {
  const method = getMethod(config.method ?? config.id);
  const selectedCutoffParameters = method.searchKind === 'cutoff' ? cutoffParameters(method, config.parameters) : undefined;
  const selectedBucketCount = selectedCutoffParameters?.bucketCount ?? (method.searchKind === 'overlap' ? overlapParameters(method, config.parameters).bucketCount : undefined);
  const engine = method.engine ?? 'opensearch';
  const index = engine === 'clickhouse' ? undefined : indexForMethod(method,config.index ?? INDEX,config.parameters);
  const table = engine === 'clickhouse' ? config.table ?? CLICKHOUSE_REAL_TABLE : undefined;
  const verifyClickHouse = dependencies.validateClickHouseReal ?? validateClickHouseReal;
  const verifyGrid = dependencies.validatePrecisionGridIndex ?? validatePrecisionGridIndex;
  const verifyOverlap = dependencies.verifyOverlapIndex ?? verifyOverlapIndex;
  const verifyOverlapBucket = dependencies.verifyOverlapBucketIndex ?? verifyOverlapBucketIndex;
  const verifyCutoff = dependencies.verifyCutoffIndex ?? verifyCutoffIndex;
  const verifyShade = dependencies.verifyShadeIndex ?? verifyShadeIndex;
  const verifyHue = dependencies.verifyHueIndex ?? verifyHueIndex;
  const backendApi = dependencies.api ?? api;
  const runSearch = dependencies.executeSearch ?? executeSearch;
  return {
    metadata: {
      id: config.id, label: method.label, ...method,
      ...(selectedBucketCount === undefined ? {} : {
        bucketCount: selectedBucketCount,
        label: config.label ?? (selectedCutoffParameters ? `${method.label} (${selectedBucketCount} buckets, ${method.profile === 'all-levels' ? `all cutoffs, blend ${selectedCutoffParameters.cutoffBlendExponent}` : `pixel cutoff ${selectedCutoffParameters.pixelCutoff}`}, ${selectedCutoffParameters.namedMode})` : `${method.namedMode === 'concrete-swatches' ? 'Overlapping regions: coverage + quality' : 'Overlapping regions + named color families'} (${selectedBucketCount.toLocaleString('en-US')} buckets)`),
        representation: `${method.metric === 'shade-hue-aware' ? 'shade-hue' : method.metric === 'shade-aware' ? 'shade' : selectedCutoffParameters ? 'cutoff' : 'overlap'}-coverage-quality-${selectedBucketCount}`,
        ...(selectedCutoffParameters ? { pixelCutoff: selectedCutoffParameters.pixelCutoff, namedMode: selectedCutoffParameters.namedMode, profile: method.profile, ...(method.profile === 'all-levels' ? { cutoffBlendExponent: selectedCutoffParameters.cutoffBlendExponent } : {}) } : {}),
        description: method.description.replace('1,024', selectedBucketCount.toLocaleString('en-US')),
      }),
      sourceFiles: ['exploration/adapter.mjs', 'exploration/registry.mjs', 'exploration/methods.mjs', 'exploration/methods-fast.mjs', 'exploration/methods-bounded.mjs', 'exploration/methods-transport.mjs', 'exploration/methods-direct-palette.mjs', 'exploration/methods-palette-bounded.mjs', 'exploration/methods-precision-typed.mjs', 'exploration/methods-precision-precomputed.mjs', 'exploration/precision-precomputed-index.mjs', 'exploration/methods-native-refined.mjs', 'exploration/methods-rank-features.mjs', 'exploration/rank-features-index.mjs', 'exploration/methods-relative.mjs', 'exploration/refinement-features.mjs', 'exploration/query.mjs', 'exploration/corpus-colors.mjs', 'exploration/service.mjs', 'exploration/clickhouse-service.mjs', 'exploration/methods-clickhouse.mjs', 'exploration/clickhouse-index.mjs', 'exploration/clickhouse-scale.mjs', 'exploration/clickhouse-compose.yml', 'exploration/methods-precision-grid.mjs', 'exploration/precision-grid-index.mjs', 'exploration/methods-overlap.mjs', 'exploration/quality-curve.mjs', 'exploration/overlap-index.mjs', 'exploration/overlap-regions.mjs', 'exploration/overlap-banks.mjs', 'exploration/overlap-bucket-index.mjs', 'exploration/methods-cutoff.mjs', 'exploration/cutoff-definition.mjs', 'exploration/cutoff-blend.mjs', 'exploration/cutoff-index.mjs', 'exploration/shade-definition.mjs', 'exploration/shade-index.mjs', 'exploration/hue-definition.mjs', 'exploration/hue-index.mjs', 'exploration/favorite-optimized-scoring.mjs', 'exploration/favorite-typed-scoring.mjs', 'exploration/favorite-utilities.mjs', 'exploration/favorite-utility-index.mjs', 'exploration/favorite-precision-utilities.mjs', 'exploration/favorite-precision-index.mjs', 'exploration/favorite-sorted-utilities.mjs', 'exploration/favorite-bounded-utilities.mjs', 'exploration/favorite-compiled-encoder.mjs', 'exploration/favorite-compiled-index.mjs'],
      execution: { kind: engine, retrieval: method.approximate ? 'approximate' : 'exact-stored-objective' },
      limitations: [...(method.limitations ?? []), 'Development judgments are from one observer; new ZIP wallpapers are unjudged.'],
    },
    supports(caseData) { return supports(method, caseData.query, { ...caseData, parameters: config.parameters }); },
    async prepare() {
      if (['favorite-optimized', 'favorite-typed', 'favorite-utilities', 'favorite-precision-utilities', 'favorite-sorted-utilities', 'favorite-bounded-utilities'].includes(method.searchKind)) {
        const expectedIds = context.corpus.map(asset => asset.id).sort();
        const [version, count, mapping, settings, documents, jvm] = await Promise.all([
          backendApi(''), backendApi(`${index}/_count`), backendApi(`${index}/_mapping`), backendApi(`${index}/_settings`),
          backendApi(`${index}/_mget?_source=false`, { method: 'POST', body: { ids: expectedIds } }),
          backendApi('_nodes/jvm?filter_path=nodes.*.jvm.mem.heap_max_in_bytes'),
        ]);
        if (count.body.count !== expectedIds.length || documents.body.docs.length !== expectedIds.length || documents.body.docs.some(doc => !doc.found)) throw Error('Favorite optimization index must contain exactly the complete evaluation corpus.');
        const actualMapping = mapping.body[index]?.mappings, actualSettings = settings.body[index]?.settings?.index;
        if (!actualMapping || !actualSettings?.uuid) throw Error('Missing optimization index fingerprint.');
        const verification = ['favorite-optimized', 'favorite-typed'].includes(method.searchKind)
          ? await verifyCutoffForRun({ context, index, bucketCount: config.parameters?.bucketCount ?? 256, verify: verifyHue, backendApi, allowCache: !dependencies.verifyHueIndex })
          : { utilityMetadata: actualMapping._meta };
        if (['favorite-utilities', 'favorite-precision-utilities', 'favorite-sorted-utilities', 'favorite-bounded-utilities'].includes(method.searchKind)) {
          const meta = actualMapping._meta;
          const definitionMatches = method.searchKind === 'favorite-precision-utilities'
            ? meta?.experiment === 'strict-hue-favorite-precision-utilities' && meta.precisionDefinitionVersion === 1 && meta.parentUtilityDefinitionVersion === 2
            : meta?.experiment === 'strict-hue-favorite-utilities' && meta.utilityDefinitionVersion === 2;
          if (!definitionMatches || meta.mode !== 'real' || meta.scope !== 'full' || !meta.encodings?.includes(method.encoding)) throw Error('Precomputed-utility index does not contain this complete real-corpus representation.');
          if (['favorite-sorted-utilities', 'favorite-bounded-utilities'].includes(method.searchKind)) {
            const fields = actualMapping.properties?.utilities?.properties;
            if (meta.numericPoints !== true || !fields || !Object.keys(fields).length || Object.values(fields).some(field => field.type !== 'float' || field.index === false || field.doc_values === false)) throw Error('Numeric-sort prototype requires indexed float utility points and doc values.');
          }
          const favoriteControls = (config.parameters?.qualityInfluence ?? .5) === .5 && (config.parameters?.cutoffBlendExponent ?? 1) === 1;
          if (meta.presets !== 'all' && !(meta.presets === 'favorite' && favoriteControls)) throw Error('Requested controls were not indexed in this utility index.');
        }
        return { ...verification, index, count: count.body.count, completeIdsVerified: true, indexUuid: actualSettings.uuid,
          mappingHash: hash(actualMapping), indexMetadata: actualMapping._meta,
          execution: { kind: 'opensearch', index, version: version.body.version.number, retrieval: 'exact-stored-objective',
            objectiveApproximation: method.objectiveApproximation ?? false,
            topology: { nodes: Object.keys(jvm.body.nodes ?? {}).length, primaryShards: Number(actualSettings.number_of_shards),
              jvmHeapMaxBytes: Object.values(jvm.body.nodes ?? {}).map(node => node.jvm.mem.heap_max_in_bytes) },
            boundary: 'query compilation + HTTP + OpenSearch filtering/ranking + response decoding' } };
      }
      if (method.searchKind === 'cutoff') {
        const hue = method.metric === 'shade-hue-aware', shade = hue || method.metric === 'shade-aware';
        const verified = await verifyCutoffForRun({ context, index, bucketCount: selectedBucketCount, verify: hue ? verifyHue : shade ? verifyShade : verifyCutoff, backendApi, allowCache: !(hue ? dependencies.verifyHueIndex : shade ? dependencies.verifyShadeIndex : dependencies.verifyCutoffIndex) });
        if (verified.completeIdsVerified !== true || verified.allValuesVerified !== true || (shade ? verified.metricDefinitionVerified !== true : verified.hard50ParityVerified !== true) || verified.count !== context.corpus.length) throw Error('Could not verify the complete cutoff corpus and its measured geometry.');
        const [version, jvm] = await Promise.all([backendApi(''), backendApi('_nodes/jvm?filter_path=nodes.*.jvm.mem.heap_max_in_bytes')]);
        const heapSizes = Object.values(jvm.body.nodes ?? {}).map(node => node.jvm?.mem?.heap_max_in_bytes);
        if (!heapSizes.length || heapSizes.some(bytes => !Number.isFinite(bytes) || bytes <= 0)) throw Error('Could not read cutoff search-service JVM heap sizes.');
        return { ...verified, execution: { kind: 'opensearch', index, version: version.body.version.number,
          topology: { nodes: heapSizes.length, primaryShards: 1, jvmHeapMaxBytes: heapSizes }, retrieval: 'exact-stored-objective', objectiveApproximation: true,
          boundary: 'query compilation + HTTP + OpenSearch filtering/ranking + response decoding' } };
      }
      if (method.searchKind === 'overlap') {
        const { bucketCount } = overlapParameters(method, config.parameters);
        const request = { index, expectedIds: context.corpus.map(asset => asset.id) };
        const verified = await (bucketCount === 1024 ? verifyOverlap(request) : verifyOverlapBucket({ ...request, bucketCount }));
        if (verified.completeIdsVerified !== true || verified.count !== context.corpus.length) throw Error('Could not verify the complete overlap-region corpus.');
        const version = await backendApi('');
        return { ...verified, execution: { kind: 'opensearch', index, version: version.body.version.number,
          topology: 'single node; one shard; 2 GiB heap; 4 GiB container limit', retrieval: 'exact-stored-objective', objectiveApproximation: true,
          boundary: 'query compilation + HTTP + OpenSearch filtering/ranking + response decoding' } };
      }
      if (engine === 'clickhouse') {
        const verified = await verifyClickHouse({ expectedIds: context.corpus.map(asset => asset.id), table });
        if (verified.expectedIdsVerified !== true || verified.count !== context.corpus.length) throw Error('Could not verify the complete ClickHouse corpus.');
        return { ...verified, storeBytes: Number(verified.parts?.bytesOnDisk), execution: { kind: 'clickhouse', version: verified.version,
          topology: { engine: 'MergeTree', nodes: 1, hostname: verified.hostname, containerLimits: verified.containerLimits },
          retrieval: 'exact-stored-objective', boundary: 'query compilation + HTTP + ClickHouse filtering/ranking + response decoding' } };
      }
      if (method.searchKind === 'precision-grid') {
        const verified = await verifyGrid({ index, expectedIds: context.corpus.map(asset => asset.id) });
        if (verified.completeIdsVerified !== true || verified.count !== context.corpus.length) throw Error('Could not verify the complete precision-grid corpus.');
        const version = await backendApi('');
        return { ...verified, descriptorHashes: { features: verified.descriptorHash, gridDefinition: verified.definitionHash, gridComputation: verified.computationHash },
          execution: { kind: 'opensearch', index, version: version.body.version.number,
            topology: 'single node; one shard; 2 GiB heap; 4 GiB container limit', retrieval: 'exact-stored-objective', objectiveApproximation: true,
            boundary: 'query compilation + HTTP + OpenSearch filtering/ranking + response decoding' } };
      }
      const [version, count, documents] = await Promise.all([backendApi(''), backendApi(`${index}/_count`),backendApi(`${index}/_mget?_source=false`,{method:'POST',body:{ids:context.corpus.map(c=>c.id)}})]);
      if (count.body.count < context.corpus.length) throw Error(`Index has ${count.body.count} documents; corpus has ${context.corpus.length}`);
      if(documents.body.docs.some(d=>!d.found))throw Error('Index is missing required corpus assets');
      return { index, count: count.body.count, descriptorHashes:await descriptors(), execution: { kind: 'opensearch', version: version.body.version.number,
        topology: 'single node; one shard; 2 GiB heap; 4 GiB container limit', retrieval: method.approximate ? 'approximate' : 'exact-stored-objective',
        boundary: 'query compilation + HTTP + OpenSearch filtering/ranking + response decoding' } };
    },
    async search({ caseData, limit, signal }) {
      const result = await runSearch({ index, table, method, query: caseData.query, limit, eligibleIds: caseData.eligibleIds, excludedIds: caseData.excludedIds, parameters: config.parameters, signal });
      return { ...result, evidence: { ...result.evidence, engine, method: method.id, approximate: method.approximate ?? false } };
    },
  };
}

export { METHODS };
