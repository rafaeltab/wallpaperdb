import {readFile,writeFile,stat,glob} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {parseCoverageReport} from '../../.coverage-experiment/build/packages/crap-typescript-core/src/index.js';
const out=process.env.EXPERIMENT_REPO_OUTPUT_ROOT||'/tmp/wallpaperdb-742/repo-wide',root=process.cwd();
const matrix=JSON.parse(await readFile(out+'/matrix.json','utf8'));
const json=async p=>JSON.parse(await readFile(p,'utf8'));
async function result(row,mode) {
 const base=`${out}/runs/${row.id}/${mode}`;
 let directory=base,provenance='legacy first pass; freshness checked against batch record',started=0;
 if(existsSync(base+'/latest.json')){const latest=await json(base+'/latest.json');directory=latest.directory;started=latest.started;provenance='unique attempt';}
 const runPath=`${out}/runs/${row.id}/${mode}-run.json`;
 let run=existsSync(runPath)?await json(runPath):null;
 // A direct rerun can supersede an older completed batch. Conversely, a new
 // batch that never reached the runner must never inherit the last attempt.
 if(run&&started>(await stat(runPath)).mtimeMs)run=null;
 if(run&&Object.hasOwn(run,'attemptDirectory')){directory=run.attemptDirectory||resolve(run.log,'../not-started');provenance=run.attemptDirectory?'launch-bound unique attempt':'launch failed before runner; no reports';}
 const exit=existsSync(directory+'/exit.json')?await json(directory+'/exit.json'):null;
 const tests=existsSync(directory+'/tests.json')?await json(directory+'/tests.json'):null;
 const report=directory+'/coverage/coverage-final.json';
 const summary={directory,provenance,run,exit,tests:tests?{success:tests.success,total:tests.numTotalTests,passed:tests.numPassedTests,failed:tests.numFailedTests,pending:tests.numPendingTests,startTime:tests.startTime,files:tests.testResults.map(r=>({name:r.name,status:r.status,assertions:r.assertionResults.map(t=>({name:t.fullName,status:t.status}))}))}:null};
 if(provenance.startsWith('legacy')&&tests&&run){const end=(await stat(runPath)).mtimeMs;summary.fresh=tests.startTime>=end-run.seconds*1000-15000&&tests.startTime<=end+15000;}
 if(existsSync(report)) {
  if(provenance.startsWith('legacy')&&run){const end=(await stat(runPath)).mtimeMs;summary.coverageFresh=(await stat(report)).mtimeMs>=end-run.seconds*1000-15000;}
  const data=await json(report);const files=Object.keys(data);const invalid=[],invalidStatements=[],invalidFunctions=[];
  for(const [f,c]of Object.entries(data))for(const [kind,values,destination,map]of [['statement',c.s,invalidStatements,c.statementMap],['function',c.f,invalidFunctions,c.fnMap]])for(const [id,count]of Object.entries(values))if(!Number.isSafeInteger(count)||count<0)destination.push({kind,file:f,line:map[id]?.loc?.start?.line??map[id]?.start?.line,id,count});
  for(const [f,c]of Object.entries(data))for(const [id,counts]of Object.entries(c.b))if(counts.some(n=>!Number.isSafeInteger(n)||n<0))invalid.push({file:f,line:c.branchMap[id]?.loc?.start?.line,id,counts});
  summary.coverage={sha256:createHash('sha256').update(await readFile(report)).digest('hex'),files:files.length,executedFiles:files.filter(f=>Object.values(data[f].s).some(n=>n>0)).length,negativeOrInvalidBranches:invalid,negativeOrInvalidStatements:invalidStatements,negativeOrInvalidFunctions:invalidFunctions,normalParser:'unrun',outsideWorkspace:files.filter(f=>!resolve(f).startsWith(resolve(root,row.runtime)+'/')),allZero:files.filter(f=>!Object.values(data[f].s).some(n=>n>0)),functions:files.reduce((s,f)=>s+Object.keys(data[f].f).length,0)};
  try{await parseCoverageReport(report,root);summary.coverage.normalParser='pass';}catch(e){summary.coverage.normalParser=e.message;}
  const selection=existsSync(directory+'/selection.json')?await json(directory+'/selection.json'):null;
  if(selection?.test.coverage.include){
   const convert=p=>selection.strategy==='compiled-native'?p.replaceAll('.js','.{ts,tsx,js}'):p;
   const expected=new Set(),excluded=new Set();
   for(const pattern of selection.originalCoverage?.include||selection.test.coverage.include.map(convert))for await(const f of glob(pattern,{cwd:resolve(root,row.runtime)}))expected.add(resolve(root,row.runtime,f));
   for(const pattern of selection.originalCoverage?.exclude||selection.test.coverage.exclude?.map(convert)||[])for await(const f of glob(pattern,{cwd:resolve(root,row.runtime)}))excluded.add(resolve(root,row.runtime,f));
   for(const f of excluded)expected.delete(f);
   summary.coverage.expected=[...expected];summary.coverage.missing=[...expected].filter(f=>!files.includes(f));summary.coverage.extra=files.filter(f=>!expected.has(f));
  }else summary.coverage.expected='no configured complete source include; observed execution only';
 }
 return summary;
}
const results=[];
for(const row of matrix.tiers)results.push({...row,candidate:await result(row,'candidate'),baseline:await result(row,'baseline')});
await writeFile(out+'/results.json',JSON.stringify({generated:new Date().toISOString(),workspaces:matrix.workspaces,absent:matrix.absent,results},null,2));
for(const r of results)console.log(r.id,r.candidate.exit?.code??r.candidate.run?.code??'pending',r.candidate.tests?`${r.candidate.tests.passed}/${r.candidate.tests.total}`:'no test report',r.candidate.coverage?`${r.candidate.coverage.files} sources; ${r.candidate.coverage.negativeOrInvalidBranches.length} invalid branches; missing ${r.candidate.coverage.missing?.length??'n/a'}`:'no coverage producer/result');
