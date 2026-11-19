import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {coverageExit} from './container-execution.mjs';
const directory=mkdtempSync('/tmp/wallpaperdb-742/repo-hillclimb/exit-control-');
try {
 writeFileSync(directory+'/coverage-control.json','{}',{mode:0o600});
 for(const status of [0,7,143]){
  const termination=status===143?'process.kill(process.pid,"SIGTERM")':`process.exit(${status})`;
  const child=`node -e 'process.stdout.write("child-out\\n"); process.stderr.write("child-err\\n"); ${termination}'`;
  const result=spawnSync('sh',['-c',child+'; '+coverageExit],{encoding:'utf8',env:{...process.env,NODE_V8_COVERAGE:directory,EXPERIMENT_V8_UID:String(process.getuid()),EXPERIMENT_V8_GID:String(process.getgid())}});
  assert.equal(result.status,status,result.stderr);
  assert.equal(result.stdout,`child-out\nOUTAGE_EXIT=${status}\n`);
  assert.ok(result.stderr.includes('child-err\n'));
 }
 console.log('Original normal/nonzero/terminated child status and streams preserved');
}finally{rmSync(directory,{recursive:true,force:true});}
