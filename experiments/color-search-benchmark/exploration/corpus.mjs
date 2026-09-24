// THROWAWAY PROTOTYPE corpus preparation. All image bytes and descriptors stay outside git.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir,readFile,writeFile,copyFile,stat,rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadDataset } from '../evaluation/loop/dataset.mjs';
import { loadCorpus,EXPERIMENT_ROOT } from '../evaluation/loop/runner.mjs';
import { FEATURE_DEFINITION } from './corpus-colors.mjs';
const execute=promisify(execFile);
export const STORE=process.env.COLOR_EVAL_STORE??path.join(os.homedir(),'.local/share/wallpaperdb/color-evaluation');
const ARCHIVE=process.env.COLOR_EXPLORATION_ARCHIVE??'/home/rafaeltab/wallpapermadness.zip';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fileHash(filename){const hash=createHash('sha256');for await(const bytes of createReadStream(filename))hash.update(bytes);return hash.digest('hex');}
async function save(filename,data){const temporary=`${filename}.tmp`;await writeFile(temporary,`${JSON.stringify(data,null,2)}\n`);await rename(temporary,filename);}
export async function importCorpus(){
  await mkdir(path.join(STORE,'corpus','wallpapermadness'),{recursive:true});
  await mkdir(path.join(STORE,'corpus','evaluation-fixtures'),{recursive:true});
  await mkdir(path.join(STORE,'corpus','expanded-thumbnails'),{recursive:true});
  const dataset=await loadDataset({root:EXPERIMENT_ROOT});
  const prior=await loadCorpus(EXPERIMENT_ROOT,dataset);
  const catalog=JSON.parse(await readFile(path.join(STORE,'catalog.json'),'utf8'));
  const catalogMap=new Map(catalog.assets.map(asset=>[asset.id,asset]));
  const assets=[];
  for(const source of prior){
    const stored=catalogMap.get(source.id);
    const filename=stored?path.join(STORE,stored.filename):path.join(STORE,'corpus','evaluation-fixtures',path.basename(source.filename));
    if(!stored)await copyFile(source.filename,filename);
    if(await fileHash(filename)!==source.sha256)throw Error(`Prior asset source hash mismatch: ${source.id}`);
    assets.push({...source,filename,thumbnail:path.join(STORE,'corpus','expanded-thumbnails',`${source.id}.jpg`),cohort:stored?'prior-wallpaper':'controlled-fixture',source:stored?{url:stored.sourceUrl,page:stored.sourcePage,license:stored.license}:{kind:'controlled-evaluation-fixture'},title:stored?.title??source.id});
  }
  console.log(`Verified ${prior.length} prior assets; importing all ZIP members.`);
  const archiveSha256=await fileHash(ARCHIVE);
  const python=String.raw`
import zipfile,hashlib,json,os,pathlib,sys,shutil
archive,destination=sys.argv[1:]
results=[]
with zipfile.ZipFile(archive) as z:
 for info in z.infolist():
  if info.is_dir(): continue
  member=pathlib.PurePosixPath(info.filename)
  if member.is_absolute() or '..' in member.parts: raise ValueError('Unsafe archive member: '+info.filename)
  if member.suffix.lower() not in ('.jpg','.jpeg','.png','.webp','.avif'): raise ValueError('Unexpected non-image member: '+info.filename)
  output=os.path.join(destination,*member.parts)
  os.makedirs(os.path.dirname(output),exist_ok=True)
  digest=hashlib.sha256()
  with z.open(info) as src,open(output+'.tmp','wb') as dst:
   while True:
    chunk=src.read(1024*1024)
    if not chunk:break
    digest.update(chunk);dst.write(chunk)
  os.replace(output+'.tmp',output)
  results.append(dict(member=info.filename,filename=output,sha256=digest.hexdigest(),bytes=info.file_size,compressedBytes=info.compress_size,crc32=info.CRC))
print(json.dumps(results))
`;
  const {stdout}=await execute('python3',['-c',python,ARCHIVE,path.join(STORE,'corpus','wallpapermadness')],{maxBuffer:4*1024*1024});
  const imported=JSON.parse(stdout),seen=new Set(assets.map(a=>a.id));
  for(const member of imported){
    const stem=path.basename(member.member,path.extname(member.member)).replace(/[^a-zA-Z0-9_-]/g,'-');
    let id=`madness-${stem}`;if(seen.has(id))id+=`-${sha(member.member).slice(0,8)}`;
    if(seen.has(id))throw Error(`Repeated archive member: ${member.member}`);seen.add(id);
    assets.push({id,filename:member.filename,sha256:member.sha256,thumbnail:path.join(STORE,'corpus','expanded-thumbnails',`${id}.jpg`),cohort:'wallpapermadness',title:stem,source:{kind:'user-provided-archive',archive:ARCHIVE,archiveSha256,member:member.member,license:'unknown',bytes:member.bytes,compressedBytes:member.compressedBytes,crc32:member.crc32}});
  }
  const hashes=new Map();for(const asset of assets){const ids=hashes.get(asset.sha256)??[];ids.push(asset.id);hashes.set(asset.sha256,ids);}
  const duplicates=[...hashes].filter(([,ids])=>ids.length>1).map(([sha256,ids])=>({sha256,ids}));
  const manifest={schemaVersion:1,createdAt:new Date().toISOString(),root:STORE,archive:{filename:ARCHIVE,sha256:archiveSha256,bytes:(await stat(ARCHIVE)).size,imageMembers:imported.length},summary:{priorAssets:prior.length,priorWallpapers:catalog.assets.length,controlledFixtures:prior.length-catalog.assets.length,archiveAssets:imported.length,totalAssets:assets.length,uniqueContentHashes:hashes.size,duplicateContentGroups:duplicates.length},duplicates,assets:assets.sort((a,b)=>a.id.localeCompare(b.id))};
  await save(path.join(STORE,'expanded-corpus.json'),manifest);
  console.log(JSON.stringify(manifest.summary));return manifest;
}
export async function extractCorpus(manifest){
  const workers=Math.max(1,Math.min(8,Number(process.env.COLOR_CORPUS_WORKERS??4)));
  const documents=new Map(),failures=[];let next=0,finished=0;
  const started=performance.now();
  await Promise.all(Array.from({length:workers},()=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./corpus-worker.mjs',import.meta.url));
    const schedule=()=>{
      if(next>=manifest.assets.length){worker.terminate().then(resolve,reject);return;}
      worker.postMessage(manifest.assets[next++]);
    };
    worker.on('error',reject);
    worker.on('message',result=>{
      finished++;
      if(result.error)failures.push(result);else{
        documents.set(result.id,result.document);
        Object.assign(manifest.assets.find(asset=>asset.id===result.id),result.metadata);
      }
      if(finished%25===0||finished===manifest.assets.length)console.log(`Extracted ${finished}/${manifest.assets.length}; failures ${failures.length}; ${Math.round((performance.now()-started)/1000)}s`);
      schedule();
    });schedule();
  })));
  if(failures.length){await save(path.join(STORE,'extraction-failures.json'),failures);throw Error(`${failures.length} extraction failures; complete corpus required.`);}
  const ordered=manifest.assets.map(a=>documents.get(a.id));
  const temporary=path.join(STORE,'features.jsonl.tmp');
  await writeFile(temporary,`${ordered.map(doc=>JSON.stringify(doc)).join('\n')}\n`);
  await rename(temporary,path.join(STORE,'features.jsonl'));
  await save(path.join(STORE,'expanded-corpus.json'),manifest);
  const sources=['corpus.mjs','corpus-worker.mjs','corpus-features.mjs','corpus-colors.mjs','../evaluation/loop/adapters.mjs'];
  const sourceHashes=Object.fromEntries(await Promise.all(sources.map(async name=>[name,await fileHash(fileURLToPath(new URL(name,import.meta.url)))])));
  const sharp=createRequire(new URL('../../../apps/color-extractor/package.json',import.meta.url))('sharp');
  const summary={schemaVersion:1,createdAt:new Date().toISOString(),documents:ordered.length,extractionMs:performance.now()-started,workers,samplePixels:16384,nodeVersion:process.version,sharpVersions:sharp.versions,alpha:'Advanced descriptors composite RGB samples on black; HSV64 retains production alpha weighting.',resize:'Advanced descriptors: EXIF orientation, sRGB,128x128 area sample. HSV64: unchanged production approximately10000-pixel aspect resize.',descriptorHashes:sourceHashes,featureDefinition:FEATURE_DEFINITION,manifestSha256:await fileHash(path.join(STORE,'expanded-corpus.json')),featuresSha256:await fileHash(path.join(STORE,'features.jsonl')),failures};
  await save(path.join(STORE,'features-summary.json'),summary);
  console.log(JSON.stringify({documents:ordered.length,extractionMs:Math.round(summary.extractionMs),features:path.join(STORE,'features.jsonl')}));
  return summary;
}
export async function validateCorpus(){
  const manifest=JSON.parse(await readFile(path.join(STORE,'expanded-corpus.json'),'utf8'));
  const docs=(await readFile(path.join(STORE,'features.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(docs.length,manifest.assets.length);
  assert.equal(new Set(docs.map(doc=>doc.id)).size,docs.length);
  const map=new Map(docs.map(doc=>[doc.id,doc]));
  const prior=await loadCorpus(EXPERIMENT_ROOT,await loadDataset({root:EXPERIMENT_ROOT}));
  for(const asset of prior)assert.equal(map.get(asset.id)?.sha256,asset.sha256);
  for(const asset of manifest.assets){
    const d=map.get(asset.id);assert.equal(d.sha256,asset.sha256);
    assert.ok(!asset.filename.startsWith(EXPERIMENT_ROOT),'Images must be outside worktree');
    assert.ok((await stat(asset.thumbnail)).size>0,'Each image has a thumbnail');
    for(const name of ['hsv64','rgb512'])assert.ok(Math.abs(d[name].reduce((a,b)=>a+b,0)-1)<1e-10,`${name} normalization ${d.id}`);
    assert.equal(d.rgb4096.reduce((sum,packed)=>sum+packed%65536,0),d.pixel_total);
    assert.equal(d.palette32_packed.reduce((sum,packed)=>sum+packed%65536,0),d.palette_total);
    assert.ok(d.palette32_packed.length<=32);
    assert.equal(d.rgb_cdf48_packed.length,48);
    for(const f of Object.values(d.features)){assert.ok(f.area>=-1e-12&&f.area<=1+1e-12);assert.ok(f.quality>=0&&f.quality<=1+1e-12);}
  }
  // Earlier loop artifacts are immutable provenance, not ranking labels.
  const referenceFilename=path.join(STORE,'runs','2026-09-20T00-04-40.946Z-4f7c77ee','hsv64-cosine.descriptors.json');
  let parity={available:false};
  try{
    const reference=JSON.parse(await readFile(referenceFilename,'utf8'));
    let maxDifference=0;
    for(const old of reference.documents)for(let i=0;i<64;i++)maxDifference=Math.max(maxDifference,Math.abs(old.histogram[i]-map.get(old.id).hsv64[i]));
    assert.equal(maxDifference,0,'HSV64 must preserve previous control extraction');
    parity={available:true,documents:reference.documents.length,maxDifference,referenceFilename};
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const summary={createdAt:new Date().toISOString(),documents:docs.length,priorIdsPreserved:prior.length,archiveImages:manifest.assets.filter(a=>a.cohort==='wallpapermadness').length,allThumbnailsPresent:true,allMassPreserved:true,allImagePathsExternal:true,hsv64Parity:parity};
  assert.equal(summary.archiveImages,manifest.archive.imageMembers);
  await save(path.join(STORE,'corpus-validation.json'),summary);console.log(JSON.stringify(summary));return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--validate-only'))await validateCorpus();
  else{
    const manifest=process.argv.includes('--extract-only')?JSON.parse(await readFile(path.join(STORE,'expanded-corpus.json'),'utf8')):await importCorpus();
    if(!process.argv.includes('--import-only')){await extractCorpus(manifest);await validateCorpus();}
  }
}
