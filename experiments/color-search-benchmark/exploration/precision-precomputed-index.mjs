import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { api, INDEX, STORE, loadFeatures, loadExpandedCorpus, hash, safeIndexName } from './service.mjs';
import { encodePaletteLab, LAB_STEP, LAB_ERROR, PRECOMPUTED_FIELDS } from './methods-precision-precomputed.mjs';

safeIndexName(INDEX);
const features = await loadFeatures(), corpus = await loadExpandedCorpus();
if (features.length !== corpus.length) throw new Error('Incomplete corpus features');
const indexed = (await api(`${INDEX}/_mget?_source=false`, { method: 'POST', body: { ids: corpus.map(c => c.id) } })).body.docs;
if (indexed.some(d => !d.found)) throw new Error('Missing wallpaper in target index');
const documents = features.map(feature => ({ id: feature.id, ...encodePaletteLab(feature) }));
await api(`${INDEX}/_mapping`, { method: 'PUT', body: { properties: PRECOMPUTED_FIELDS } });
for (let offset = 0; offset < documents.length; offset += 100) {
  const body = documents.slice(offset, offset + 100).map(({ id, ...doc }) => JSON.stringify({ update: { _id: id } }) + '\n' + JSON.stringify({ doc }) + '\n').join('');
  const result = await api(`${INDEX}/_bulk`, { method: 'POST', body });
  if (result.body.errors) throw new Error('Precomputed OKLab index update failed');
}
await api(`${INDEX}/_refresh`, { method: 'POST' });
await writeFile(path.join(STORE, 'precision-precomputed-features.jsonl'), documents.map(doc => JSON.stringify(doc)).join('\n') + '\n');
const receipt = { index: INDEX, count: documents.length, createdAt: new Date().toISOString(), fields: Object.keys(PRECOMPUTED_FIELDS), featureHash: hash(features), descriptorHash: hash(documents), coordinateStep: LAB_STEP, coordinateDistanceErrorBound: LAB_ERROR, methodSourceHash: hash(await readFile(fileURLToPath(new URL('./methods-precision-precomputed.mjs', import.meta.url)))) };
await writeFile(path.join(STORE, 'precision-precomputed-index-receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
