// THROWAWAY PROTOTYPE recovery: only fill missing documents in our incomplete
// cutoff index. Existing documents must exactly match immutable measurements.
// Kept separate so recovery does not change the extraction fingerprints.
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { loadCutoffDocuments, verifyCutoffIndex } from './cutoff-index.mjs';
import { cutoffIndexForCount } from './cutoff-definition.mjs';
import { api, bulkIndex, finishIndex, STORE, hash } from './service.mjs';

const bucketCount = Number(process.argv[2] ?? 1024), index = cutoffIndexForCount(bucketCount);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const mapping = (await api(index + '/_mapping')).body[index]?.mappings;
const metadata = mapping?._meta;
if (metadata?.experiment !== 'multi-cutoff-overlapping-coverage-quality' || metadata.bucketCount !== bucketCount || !metadata.directory) throw Error('Refusing to resume an unrelated index.');
const preparation = JSON.parse(await readFile(path.join(metadata.directory, 'metadata.json'), 'utf8'));
if (metadata.identityHash !== preparation.identityHash || metadata.descriptorHash !== preparation.descriptorHash || metadata.count !== preparation.count) throw Error('Refusing to resume index with different descriptor provenance.');
const documents = await loadCutoffDocuments(bucketCount), byId = new Map(documents.map(document => [document.id, document]));
if (byId.size !== documents.length || documents.length !== metadata.count) throw Error('Expected complete unique measured corpus.');
await api(index + '/_flush', { method: 'POST' });
await api(index + '/_refresh', { method: 'POST' });
const response = (await api(index + '/_search', { method: 'POST', body: { size: documents.length, _source: false, track_total_hits: true, query: { match_all: {} } } })).body;
if (response.timed_out || response._shards?.failed || response.hits.total.value > documents.length) throw Error('Partial response or unexpected documents in recovery index.');
const ids = response.hits.hits.map(hit => hit._id);
for (let offset = 0; offset < ids.length; offset += 5) {
  const hits = (await api(index + '/_mget', { method: 'POST', body: { ids: ids.slice(offset, offset + 5) } })).body.docs;
  for (const hit of hits) if (!hit.found || !byId.has(hit._id) || hash(canonical(hit._source)) !== hash(canonical(byId.get(hit._id)))) throw Error(`Refusing to overwrite unexpected existing data: ${hit._id}.`);
}
const present = new Set(ids), missing = documents.filter(document => !present.has(document.id)), started = performance.now();
console.error(`Verified ${present.size} existing documents; adding only ${missing.length} missing documents.`);
for (let offset = 0; offset < missing.length; offset++) {
  await bulkIndex(index, [missing[offset]]);
  if ((offset + 1) % 25 === 0) {
    await api(index + '/_flush', { method: 'POST' });
    console.error(`Recovered ${offset + 1}/${missing.length} documents with periodic flush.`);
  }
}
await api(index + '/_flush', { method: 'POST' });
await finishIndex(index);
const verification = await verifyCutoffIndex({ bucketCount });
const result = { ...verification, recovered: true, existingVerified: present.size, inserted: missing.length, recoveredAt: new Date().toISOString(), recoveryMs: performance.now() - started, stats: (await api(index + '/_stats/store,docs,segments')).body._all };
await writeFile(path.join(STORE, index + '.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
