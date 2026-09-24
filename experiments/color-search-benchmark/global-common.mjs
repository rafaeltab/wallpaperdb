// PROTOTYPE helpers restricted to the dedicated local OpenSearch experiment.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
export const ROOT=new URL('./',import.meta.url);
export const BASE='http://127.0.0.1:19216';
export const REAL_INDEX='color-global-real-v1';
export const indexName=(kind,count)=>`color-global-${kind}-${count}-v1`;
export const readJson=async(path)=>JSON.parse(await readFile(new URL(path,ROOT),'utf8'));
export async function saveJson(path,value){await mkdir(new URL('output/',ROOT),{recursive:true});await writeFile(new URL(path,ROOT),JSON.stringify(value,null,2)+'\n');}
export async function api(path,body,method=body===undefined?'GET':'POST'){
  const started=performance.now();
  const response=await fetch(BASE+path,{method,headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
  const data=await response.json();
  if(!response.ok)throw new Error(`${method} ${path}: ${JSON.stringify(data).slice(0,4000)}`);
  return {body:data,wallMs:performance.now()-started};
}
export async function recreateIndex(index,properties,settings={}){
  if(!index.startsWith('color-global-'))throw new Error('Refusing a non-experiment index.');
  const exists=await fetch(`${BASE}/${index}`,{method:'HEAD'});
  if(exists.ok)await api(`/${index}`,undefined,'DELETE');
  await api(`/${index}`,{settings:{number_of_shards:3,number_of_replicas:0,refresh_interval:'-1',...settings},mappings:{dynamic:'strict',properties}},'PUT');
}
export async function bulk(index,documents){
  if(!index.startsWith('color-global-'))throw new Error('Refusing a non-experiment index.');
  const body=documents.map(doc=>`${JSON.stringify({index:{_index:index,_id:doc.id}})}\n${JSON.stringify(doc)}\n`).join('');
  const response=await fetch(BASE+'/_bulk',{method:'POST',headers:{'content-type':'application/x-ndjson'},body,signal:AbortSignal.timeout(180000)});
  const data=await response.json();
  if(!response.ok||data.errors)throw new Error(`Bulk failed: ${JSON.stringify(data.items?.filter(item=>item.index.error).slice(0,2)??data).slice(0,3000)}`);
  return data.took;
}
export const metadataProperties={id:{type:'keyword'},cohort:{type:'keyword'},partition:{type:'integer'},reference_id:{type:'keyword'}};
export const distribution=(values)=>{
  const sorted=[...values].sort((a,b)=>a-b);
  const at=p=>sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)];
  return {samples:values.length,min:sorted[0],median:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)};
};
export function randomGenerator(seed=0x20260917){
  let state=seed>>>0;
  return ()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
}
export async function waitForIdle(){
  let quiet=0;
  for(let attempt=0;attempt<180;attempt++){
    const nodes=Object.values((await api('/_nodes/stats/indices')).body.nodes);
    const busy=nodes.reduce((sum,node)=>sum+node.indices.merges.current+node.indices.indexing.index_current,0);
    quiet=busy?0:quiet+1;
    if(quiet>=5)return;
    if(busy&&attempt%10===0)console.log(`Waiting for scratch OpenSearch indexing/merges: ${busy} active.`);
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('Scratch OpenSearch indexing/merges did not settle before benchmarking.');
}
