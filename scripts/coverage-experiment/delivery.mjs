// Opt-in producer for the existing unit/integration report and CRAP contracts.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,readdir,writeFile,rm,cp,glob} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readlinkSync,openSync,writeFileSync,closeSync,readFileSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute} from 'node:path';
import {auditReports} from './report-audit.mjs';
import {publishReports,coverageMap} from './publish-reports.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),base=resolve(root,'.coverage-experiment/production');
const pointer=resolve(base,'latest.json'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
export async function clearAggregate(directory=resolve(root,'coverage')) {
 // The normal CRAP caller owns this lock through coverage and analysis.
 // Clearing a report must never release that caller's concurrency contract.
 await mkdir(directory,{recursive:true});
 for(const name of await readdir(directory))if(name!=='.crap-lock')await rm(resolve(directory,name),{recursive:true,force:true});
}
function environment(extra={}){
 const env={...process.env,...extra,MAKEFLAGS:(process.env.MAKEFLAGS||'').split(' -- ')[0]};
 for(const key of ['MAKEOVERRIDES','ARGS','SCRIPT','PACKAGE','PACKAGES','TURBO_FLAGS'])delete env[key];
 return env;
}
function make(args,extra={}){
 const stdio=['inherit','inherit','inherit'],fd=Number(process.env.WALLPAPERDB_DOCKER_LEASE_FD);
 try{if(fd>=3&&readlinkSync(`/proc/self/fd/${fd}`)===process.env.WALLPAPERDB_DOCKER_LEASE_FILE){while(stdio.length<=fd)stdio.push('ignore');stdio[fd]=fd;}}catch{}
 const child=spawnSync('make',args,{cwd:root,env:environment(extra),stdio});
 assert.equal(child.status,0,`Coverage command failed: make ${args.join(' ')} (${child.signal||child.status})`);
}
function inside(workspace,path){
 const rel=relative(resolve(root,workspace),path);
 assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),`Coverage path is outside its workspace: ${path}`);
}
export async function mergePublished(){
 const latest=await json(pointer);assert.equal(latest.status,'success','No successful current compiled coverage generation');
 const manifest=await json(latest.manifest),combined=coverageMap({});
 for(const [path,expected]of Object.entries(manifest.sourceHashes))assert.equal(sha(await readFile(path)),expected,`Coverage source changed: ${path}`);
 for(const item of manifest.outputs){
  const bytes=await readFile(item.path);assert.equal(sha(bytes),item.sha256,`Coverage report changed: ${item.path}`);
  combined.merge(coverageMap(JSON.parse(bytes)));
 }
 await publishReports(combined.toJSON(),resolve(root,'coverage'));
 await writeFile(resolve(root,'coverage/compiled-manifest.json'),JSON.stringify(manifest,null,2));
 return manifest;
}
async function main(){
 if(process.argv.includes('--merge-only')){await mergePublished();return;}
 const args=process.argv.slice(2);let selected;
 for(let i=0;i<args.length;i++){
  assert.ok(['--package','--packages'].includes(args[i]),`Unknown coverage argument: ${args[i]}`);
  selected=args[++i]?.split(',');assert.ok(selected?.every(n=>/^[a-z0-9-]+$/.test(n)),'Select workspace short names');
 }
 await mkdir(base,{recursive:true});const lock=base+'/producer.lock';
 try{const old=JSON.parse(readFileSync(lock,'utf8'));try{process.kill(old.pid,0);}catch(error){if(error.code==='ESRCH')unlinkSync(lock);else throw error;}}catch(error){if(error.code!=='ENOENT')throw error;}
 const handle=openSync(lock,'wx');writeFileSync(handle,JSON.stringify({pid:process.pid}));closeSync(handle);
 const attempt=await mkdtemp(base+'/attempt-');let outputs=[];
 await writeFile(pointer,JSON.stringify({status:'running',attempt}));
 try{
  make(['run','PACKAGE=root','SCRIPT=experiment:coverage:repo-inventory'],{EXPERIMENT_REPO_OUTPUT_ROOT:attempt});
  const inventory=await json(attempt+'/matrix.json');
  const rows=inventory.tiers.filter(r=>/^(apps|packages)\//.test(r.workspace)&&r.workspace!=='apps/web-e2e'&&['test:unit','test:integration'].includes(r.script)&&(!selected||selected.includes(r.workspace.split('/')[1])));
  assert.ok(rows.length,'No unit/integration coverage producers selected');
  for(const name of selected||[])assert.ok(rows.some(row=>row.workspace.split('/')[1]===name),`No unit/integration coverage producer for ${name}`);
  assert.ok(rows.every(r=>r.coverage),'Selected test tier does not enable coverage');
  const workspaces=[...new Set(rows.map(r=>r.workspace))];
  outputs=workspaces.flatMap(workspace=>['unit','integration'].map(tier=>resolve(root,workspace,'coverage',tier)));
  const manifest={attempt,status:'running',workspaces,outputs:[],sourceHashes:{},audit:[],scope:'configured unit/integration producers; E2E and test-only workspaces are not implied'};
  // Clear declared outputs before work starts. A failed generation cannot
  // expose a previous success to CRAP, merge or coverage-summary.
  for(const workspace of workspaces)for(const tier of ['unit','integration'])await rm(resolve(root,workspace,'coverage',tier),{recursive:true,force:true});
  await clearAggregate();
  const filters=workspaces.map(w=>`--filter=@wallpaperdb/${w.split('/')[1]}...`).join(' ');
  make(['build',`TURBO_FLAGS=${filters} --concurrency=1`]);
  make(['run','PACKAGE=root','SCRIPT=experiment:coverage:prepare'],{COVERAGE_DELIVERY:'1'});
  const produced=[];
  for(const row of rows){
   const command=['run','PACKAGE=root','SCRIPT=experiment:coverage:repo',`ARGS=${row.id} candidate`];
   make(row.containers?['docker-run',`ARGS=make run PACKAGE=root SCRIPT=experiment:coverage:repo ARGS="${row.id} candidate"`]:command,{EXPERIMENT_REPO_OUTPUT_ROOT:attempt,COVERAGE_DELIVERY:'1',EXPERIMENT_CAPTURE_FACTORY:attempt+'/factory-v8-inputs.jsonl'});
   const latest=await json(`${attempt}/runs/${row.id}/candidate/latest.json`),directory=latest.directory;
   const exit=await json(directory+'/exit.json');assert.equal(exit.code,0);assert.equal(exit.implementationChangedDuringRun,false,'Tooling changed during coverage run');
   const tests=await json(directory+'/tests.json');assert.equal(tests.success,true,'Test report did not pass');
   const selection=await json(directory+'/selection.json'),rawPath=directory+'/coverage/coverage-final.json',data=await json(rawPath);
   for(const [path,file]of Object.entries(data)){inside(row.workspace,path);assert.equal(file.path,path);manifest.sourceHashes[path]=sha(await readFile(path));}
   for(const pattern of selection.originalCoverage?.include||[]){
    const excluded=new Set();for(const p of selection.originalCoverage.exclude||[])for await(const f of glob(p,{cwd:resolve(root,row.runtime)}))excluded.add(f);
    for await(const file of glob(pattern,{cwd:resolve(root,row.runtime)}))if(!excluded.has(file))assert.ok(data[resolve(root,row.runtime,file)],`Missing original coverage source: ${file}`);
   }
   const override=row.args.find(a=>a.startsWith('--coverage.reportsDirectory='))?.split('=').slice(1).join('=');
   const reports=override||selection.originalCoverage?.reportsDirectory||'coverage';
   const cwd=resolve(root,row.strategy==='compiled-native'?'.coverage-experiment/build':'',row.runtime);
   const destination=resolve(root,row.runtime,relative(cwd,resolve(cwd,reports)));inside(row.workspace,destination);
   assert.ok(relative(resolve(root,row.workspace,'coverage'),destination).startsWith('..')===false,'Unexpected report destination');
   produced.push({id:row.id,data,row,rawPath,destination});
  }
  const audited=auditReports(produced.map(({id,data})=>({id,data})),root);manifest.audit=audited.audit;
  for(let i=0;i<produced.length;i++){
   const item=produced[i],data=audited.reports[i].data,stage=resolve(attempt,'published',item.id);
   await publishReports(data,stage);
   await writeFile(stage+'/coverage-audit.json',JSON.stringify({rawReport:item.rawPath,rawSHA256:sha(await readFile(item.rawPath)),entries:manifest.audit.filter(a=>a.report===item.id)},null,2));
   item.stage=stage;
  }
  // Publish only after every test, inventory, audit and renderer succeeded.
  for(const item of produced){await cp(item.stage,item.destination,{recursive:true});const path=item.destination+'/coverage-final.json';manifest.outputs.push({id:item.id,workspace:item.row.workspace,path,sha256:sha(await readFile(path)),rawReport:item.rawPath});}
  manifest.status='success';const path=attempt+'/manifest.json';await writeFile(path,JSON.stringify(manifest,null,2));
  await writeFile(pointer,JSON.stringify({status:'success',attempt,manifest:path}));
  await mergePublished();
  const estimated=manifest.audit.filter(entry=>entry.published===1).length;
  console.error(`Compiled coverage: ${workspaces.join(', ')}; ${rows.length} reports; ${manifest.audit.length}/2 audited branch arms (${estimated} estimated-covered, ${manifest.audit.length-estimated} conservatively uncovered). Audit: ${path}`);
 }catch(error){
  for(const output of outputs)await rm(output,{recursive:true,force:true});await clearAggregate();
  await writeFile(pointer,JSON.stringify({status:'failed',attempt,error:error.message}));throw error;
 }finally{unlinkSync(lock);}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
