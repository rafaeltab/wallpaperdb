// Query compilation is local; every candidate hit and score comes from its search service.
import { METHODS, getMethod, supports, executeSearch, indexForMethod } from './registry.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { api, INDEX, CORPUS_STORE, hash } from './service.mjs';
import { validateClickHouseReal } from './clickhouse-index.mjs';
import { CLICKHOUSE_REAL_TABLE } from './clickhouse-service.mjs';
import { validatePrecisionGridIndex } from './precision-grid-index.mjs';
let descriptorHashes;
const descriptors=()=>descriptorHashes??=Promise.all(['features.jsonl','refinement-features.jsonl'].map(async name=>[name,hash(await readFile(path.join(CORPUS_STORE,name)))])).then(Object.fromEntries);

export async function createCandidate({ config, context }, dependencies = {}) {
  const method = getMethod(config.method ?? config.id);
  const engine = method.engine ?? 'opensearch';
  const index = engine === 'clickhouse' ? undefined : indexForMethod(method,config.index ?? INDEX);
  const table = engine === 'clickhouse' ? config.table ?? CLICKHOUSE_REAL_TABLE : undefined;
  const verifyClickHouse = dependencies.validateClickHouseReal ?? validateClickHouseReal;
  const verifyGrid = dependencies.validatePrecisionGridIndex ?? validatePrecisionGridIndex;
  const backendApi = dependencies.api ?? api;
  const runSearch = dependencies.executeSearch ?? executeSearch;
  return {
    metadata: {
      id: config.id, label: method.label, ...method,
      sourceFiles: ['exploration/adapter.mjs', 'exploration/registry.mjs', 'exploration/methods.mjs', 'exploration/methods-fast.mjs', 'exploration/methods-bounded.mjs', 'exploration/methods-transport.mjs', 'exploration/methods-direct-palette.mjs', 'exploration/methods-palette-bounded.mjs', 'exploration/methods-precision-typed.mjs', 'exploration/methods-precision-precomputed.mjs', 'exploration/precision-precomputed-index.mjs', 'exploration/methods-native-refined.mjs', 'exploration/methods-rank-features.mjs', 'exploration/rank-features-index.mjs', 'exploration/methods-relative.mjs', 'exploration/refinement-features.mjs', 'exploration/query.mjs', 'exploration/corpus-colors.mjs', 'exploration/service.mjs', 'exploration/clickhouse-service.mjs', 'exploration/methods-clickhouse.mjs', 'exploration/clickhouse-index.mjs', 'exploration/clickhouse-scale.mjs', 'exploration/clickhouse-compose.yml', 'exploration/methods-precision-grid.mjs', 'exploration/precision-grid-index.mjs'],
      execution: { kind: engine, retrieval: method.approximate ? 'approximate' : 'exact-stored-objective' },
      limitations: [...(method.limitations ?? []), 'Development judgments are from one observer; new ZIP wallpapers are unjudged.'],
    },
    supports(caseData) { return supports(method, caseData.query, { ...caseData, parameters: config.parameters }); },
    async prepare() {
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
