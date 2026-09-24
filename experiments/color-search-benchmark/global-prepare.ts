// PROTOTYPE: derive indexed family measurements from actual source pixels.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { NATIVE_FAMILIES } from './global-native.mjs';
import { compileFamilies, measureFamilies, measureWeightedColors } from './global-pixels.mjs';
import { labToRgb, rgbToChannels } from './ranges.mjs';
const root=new URL('./',import.meta.url);
const sharp=createRequire(new URL('../../apps/color-extractor/package.json',import.meta.url))('sharp');
const sha=(bytes:any)=>createHash('sha256').update(bytes).digest('hex');
const data=JSON.parse(await readFile(new URL('proportions-data.json',root),'utf8'));
assert.equal(data.wallpapers.length,100);
const families=compileFamilies(NATIVE_FAMILIES);
const sourceHashes=Object.fromEntries(await Promise.all(['global-prepare.ts','global-pixels.mjs','global-native.mjs','ranges.mjs','corpus-manifest.json','proportions-data.json','ranges-fixtures.json'].map(async path=>[path,sha(await readFile(new URL(path,root)))])));
const key=sha(JSON.stringify({sourceHashes,families:NATIVE_FAMILIES,originals:data.wallpapers.map((d:any)=>d.sha256),side:256}));
const docs=[];
let cache:any;
try{cache=JSON.parse(await readFile(new URL('global-data.json',root),'utf8'));}catch(error:any){if(error.code!=='ENOENT')throw error;}
if(cache?.cacheKey===key){console.log('Global source-pixel features are current: 100 real wallpapers.');process.exit(0);}
for(const [i,doc]of data.wallpapers.entries()){
  const bytes=await readFile(new URL(doc.filename,root));assert.equal(sha(bytes),doc.sha256,doc.id);
  const sampled=await sharp(bytes).ensureAlpha().resize({width:256,height:256,fit:'inside',withoutEnlargement:true}).raw().toBuffer();
  docs.push({...doc,cohort:'real',partition:i%10,...measureFamilies(sampled,families)});
  if((i+1)%20===0)console.log(`Measured global indexed features: ${i+1}/100`);
}
const rawFixtures=JSON.parse(await readFile(new URL('ranges-fixtures.json',root),'utf8')).fixtures;
const fixtures=rawFixtures.map((doc:any,i:number)=>{
  return {...doc,cohort:'fixture',partition:i%10,...measureWeightedColors(doc.palette.map((p:any)=>({point:{...rgbToChannels(labToRgb(p.lab)),lab:p.lab},weight:p.weight})),families)};
});
await mkdir(new URL('output/',root),{recursive:true});
await writeFile(new URL('global-data.json',root),JSON.stringify({generatedAt:new Date().toISOString(),cacheKey:key,sourceHashes,families:NATIVE_FAMILIES,wallpapers:docs,fixtures}));
console.log(`Saved global-data.json: 100 actual wallpapers, ${fixtures.length} known fixtures, ${families.length} indexed families.`);
