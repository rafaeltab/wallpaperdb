import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const root=process.cwd()+'/experiments/color-search-benchmark/';
const {validateInput,createGlobalServer}=await import(pathToFileURL(root+'global-server.mjs'));
const valid={method:'native',colors:[{family:'red',amount:.7},{family:'dark',amount:.3}],cohort:'real',limit:20};
assert.equal(validateInput(valid).colors.length,2);
const five=['red','green','blue','white','dark'].map(family=>({family,amount:.2}));
for(const method of ['multi','adaptive-multi']){assert.equal(validateInput({...valid,method,colors:five}).colors.length,5);assert.throws(()=>validateInput({...valid,method,colors:[...five,{family:'yellow',amount:0}]}));}
for(const method of ['adaptive-fine','adaptive-joint'])assert.equal(validateInput({...valid,method}).colors.length,2);
for(const invalid of [
 {...valid,index:'production'}, {...valid,method:'script'}, {...valid,limit:21},
 {...valid,colors:[{family:'red',amount:1.1}]}, {...valid,colors:[{family:'red',amount:.7},{family:'green',amount:.7}]},
 {...valid,colors:[{family:'red',amount:.2},{family:'red',amount:.3}]},
 {...valid,method:'dynamic',colors:[{family:'red',amount:.2},{family:'green',amount:.3},{family:'dark',amount:.4}]},
 {...valid,colors:[{family:'__proto__',amount:.5}]}, {...valid,cohort:'all'},
])assert.throws(()=>validateInput(invalid));
const html=await readFile(root+'global.html','utf8');
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
new AsyncFunction(script);
const server=createGlobalServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
try{
 assert.equal((await fetch(base+'/global.html')).status,200);
 const config=await (await fetch(base+'/api/config')).json();
 assert.equal(config.realCount,100);assert.equal(config.families.length,18);
 assert.equal((await fetch(base+'/%2e%2e%2f%2e%2e%2fAGENTS.md')).status,404);
 assert.equal((await fetch(base+'/global-compose.yml')).status,404);
 assert.equal((await fetch(base+'/api/search')).status,405);
 assert.equal((await fetch(base+'/api/search',{method:'POST',headers:{'content-type':'application/json',origin:'http://foreign.example'},body:JSON.stringify(valid)})).status,403);
 assert.equal((await fetch(base+'/api/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...valid,index:'production'})})).status,400);
 assert.equal((await fetch(base+'/api/search',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(9000)})).status,413);
 console.log('UI check passed: script syntax, strict search validation, static containment, origin/body limits, current corpus configuration.');
}finally{await new Promise(resolve=>server.close(resolve));}
