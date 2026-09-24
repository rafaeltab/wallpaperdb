import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { api, INDEX, STORE, loadFeatures, loadExpandedCorpus, hash } from './service.mjs';
import { paletteCellIds } from './methods-palette-bounded.mjs';

const features=await loadFeatures(),corpus=await loadExpandedCorpus();
if(features.length!==corpus.length)throw Error('Incomplete corpus features');
const indexed=(await api(`${INDEX}/_mget?_source=false`,{method:'POST',body:{ids:corpus.map(c=>c.id)}})).body.docs;
if(indexed.some(d=>!d.found))throw Error('Missing wallpaper in target index');
await api(`${INDEX}/_mapping`,{method:'PUT',body:{properties:{palette_cells:{type:'keyword'}}}});
for(let offset=0;offset<features.length;offset+=100){
  const body=features.slice(offset,offset+100).map(feature=>JSON.stringify({update:{_id:feature.id}})+'\n'+JSON.stringify({doc:{palette_cells:paletteCellIds(feature)}})+'\n').join('');
  const result=await api(`${INDEX}/_bulk`,{method:'POST',body});
  if(result.body.errors)throw Error('Palette cell index update failed');
}
await api(`${INDEX}/_refresh`,{method:'POST'});
const receipt={index:INDEX,count:features.length,createdAt:new Date().toISOString(),fields:['palette_cells'],featureHash:hash(features)};
await writeFile(path.join(STORE,'palette-cell-index-receipt.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt));
