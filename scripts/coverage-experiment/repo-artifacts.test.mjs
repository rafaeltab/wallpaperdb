import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
const base='/tmp/wallpaperdb-742/repo-wide/runs/packages-auth-unit-1/candidate-focus';
const run=filter=>spawnSync('make',['run','PACKAGE=root','SCRIPT=experiment:coverage:repo','ARGS=packages-auth-unit-1 candidate'],{env:{...process.env,EXPERIMENT_REPO_FILTER:filter},encoding:'utf8'});
const good=run('test/service-token.test.js');assert.equal(good.status,0,good.stdout+good.stderr);
const prior=existsSync(base+'/latest.json')?JSON.parse(await readFile(base+'/latest.json','utf8')).directory:base;
assert.ok(existsSync(prior+'/tests.json'));
const bad=run('--definitely-invalid-option');assert.notEqual(bad.status,0);
const current=existsSync(base+'/latest.json')?JSON.parse(await readFile(base+'/latest.json','utf8')).directory:base;
assert.ok(!existsSync(current+'/tests.json'),'early failure exposed stale success test report');
assert.ok(!existsSync(current+'/coverage/coverage-final.json'),'early failure exposed stale coverage');
assert.ok(existsSync(prior+'/tests.json'),'previous evidence lost');
console.log('Early failed attempt is isolated; prior success retained', {prior,current});

// Exercise the public batch, direct runner and report consumer in an isolated
// evidence root. The only failing input is an unsupported CLI option.
const evidence=await mkdtemp('/tmp/wallpaperdb-742/repo-wide/provenance-regression-');
const inventory=JSON.parse(await readFile('/tmp/wallpaperdb-742/repo-wide/matrix.json','utf8'));
const row=inventory.tiers.find(r=>r.id==='packages-auth-unit-1');
const fixture={...inventory,tiers:[row]};
const matrixPath=evidence+'/matrix.json';
await writeFile(matrixPath,JSON.stringify(fixture));
const invoke=(script,args)=>{
 const result=spawnSync('make',['run','PACKAGE=root',`SCRIPT=experiment:coverage:${script}`,...(args?[`ARGS=${args}`]:[])],{env:{...process.env,EXPERIMENT_REPO_OUTPUT_ROOT:evidence},encoding:'utf8'});
 return result;
};
const batch=invoke('repo-batch',row.id);assert.equal(batch.status,0,batch.stdout+batch.stderr);
assert.equal(invoke('repo-report').status,0);
const load=async()=>JSON.parse(await readFile(evidence+'/results.json','utf8')).results[0].candidate;
const passed=await load();assert.equal(passed.tests.success,true);assert.ok(passed.coverage);
row.args.push('--definitely-invalid-option');await writeFile(matrixPath,JSON.stringify(fixture));
assert.notEqual(invoke('repo',row.id+' candidate').status,0);
assert.equal(invoke('repo-report').status,0);
const failed=await load();assert.equal(failed.exit.code,1);assert.equal(failed.tests,null,'direct failure exposed earlier batch success');assert.equal(failed.coverage,undefined,'direct failure exposed earlier batch coverage');
assert.ok(existsSync(passed.directory+'/tests.json'));
// A queue/launcher failure has a batch record but no runner attempt. It must
// supersede both prior attempts without reading either report directory.
const runPath=evidence+'/runs/'+row.id+'/candidate-run.json';
await writeFile(runPath,JSON.stringify({code:2,attemptDirectory:null,log:evidence+'/queue-failed.log'}));
assert.equal(invoke('repo-report').status,0);
const unstarted=await load();assert.equal(unstarted.tests,null);assert.equal(unstarted.coverage,undefined);assert.equal(unstarted.run.code,2);
console.log('Batch success, direct early failure and pre-run failure remain distinct',evidence);
