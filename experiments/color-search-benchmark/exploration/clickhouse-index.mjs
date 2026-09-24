import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rgbToLab } from './corpus-colors.mjs';
import { loadFeatures, loadExpandedCorpus, STORE, hash } from './service.mjs';
import { CLICKHOUSE_REAL_TABLE, safeClickHouseTable, clickHouseRequest, countTable, clickHouseMetadata } from './clickhouse-service.mjs';
export const CLICKHOUSE_RECEIPT = path.join(STORE, 'clickhouse-real-index-receipt.json');
export function toClickHouseDocument(feature) {
  const packed = [...feature.palette32_packed].sort((a,b) => a-b);
  const result = { id: feature.id, reference_id: feature.reference_id ?? feature.id, cohort: feature.cohort ?? 'real', partition: feature.partition ?? 0, palette_l: [], palette_a: [], palette_b: [], palette_w: [] };
  for (const value of packed) {
    const rgb = Math.floor(value / 65536), count = value % 65536;
    const lab = rgbToLab([(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255]);
    result.palette_l.push(lab[0]); result.palette_a.push(lab[1]); result.palette_b.push(lab[2]); result.palette_w.push(count / feature.palette_total);
  }
  return result;
}
export async function createClickHouseTable(table) {
  await clickHouseRequest(`CREATE TABLE ${safeClickHouseTable(table)} (id String,reference_id String,cohort LowCardinality(String),partition UInt8,palette_l Array(Float64),palette_a Array(Float64),palette_b Array(Float64),palette_w Array(Float64)) ENGINE=MergeTree ORDER BY (partition,id)`);
}
export async function insertClickHouseDocuments(table, documents) {
  await clickHouseRequest(`INSERT INTO ${safeClickHouseTable(table)} FORMAT JSONEachRow`, { data: documents.map(doc => JSON.stringify(doc)).join('\n') + '\n', timeoutMs: 120000 });
}
export async function validateClickHouseReal({ expectedIds, table = CLICKHOUSE_REAL_TABLE } = {}) {
  const expected = expectedIds ?? (await loadExpandedCorpus()).map(asset => asset.id);
  const response = await clickHouseRequest(`SELECT id FROM ${safeClickHouseTable(table)} ORDER BY id FORMAT JSON`);
  const actual = response.body.data.map(row => row.id), actualSet = new Set(actual), expectedSet = new Set(expected);
  if (actual.length !== expected.length || actualSet.size !== actual.length || expectedSet.size !== expected.length || expected.some(id => !actualSet.has(id))) throw new Error('ClickHouse corpus ID coverage differs from the required corpus');
  const receipt = JSON.parse(await readFile(CLICKHOUSE_RECEIPT, 'utf8'));
  return { ...receipt, count: actual.length, expectedIdsVerified: true, ...await clickHouseMetadata(table) };
}
export async function prepareClickHouseReal() {
  const features = await loadFeatures(), corpus = await loadExpandedCorpus();
  if (features.length !== corpus.length || new Set(features.map(f => f.id)).size !== corpus.length || features.some(f => !corpus.some(c => c.id === f.id))) throw new Error('Incomplete ClickHouse source corpus');
  const documents = features.map(toClickHouseDocument), started = performance.now();
  await createClickHouseTable(CLICKHOUSE_REAL_TABLE);
  for (let i=0;i<documents.length;i+=100) await insertClickHouseDocuments(CLICKHOUSE_REAL_TABLE, documents.slice(i,i+100));
  const counts = await countTable(CLICKHOUSE_REAL_TABLE);
  if (counts.count !== features.length || counts.uniqueIds !== features.length) throw new Error('ClickHouse index cardinality mismatch');
  const descriptorHashes = { sourceFeatures: hash(features), clickhouseDocuments: hash(documents), colorTransform: hash(rgbToLab.toString()) };
  const receipt = { table: CLICKHOUSE_REAL_TABLE, count: features.length, createdAt: new Date().toISOString(), indexMs: performance.now()-started, descriptorHashes, sourceHashes: Object.fromEntries(await Promise.all(['clickhouse-service.mjs','methods-clickhouse.mjs','clickhouse-index.mjs','corpus-colors.mjs'].map(async name => [name,hash(await readFile(new URL(name,import.meta.url)))]))), ...await clickHouseMetadata() };
  await mkdir(STORE,{recursive:true});
  await writeFile(path.join(STORE,'clickhouse-real-descriptors.jsonl'),documents.map(doc=>JSON.stringify(doc)).join('\n')+'\n');
  await writeFile(CLICKHOUSE_RECEIPT,JSON.stringify(receipt,null,2));
  return validateClickHouseReal({expectedIds:corpus.map(c=>c.id)});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await prepareClickHouseReal(),null,2));
