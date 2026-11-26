import {beginAttempt} from './repo-artifacts.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openSync,closeSync,writeFileSync,existsSync} from 'node:fs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=beginAttempt('/tmp/wallpaperdb-742/repo-wide/runs/apps-web-e2e-e2e/candidate',root,{id:'apps-web-e2e-e2e',mode:'candidate',strategy:'unchanged original Playwright path',config:resolve(root,'apps/web-e2e/playwright.config.ts'),sourceConfig:resolve(root,'apps/web-e2e/playwright.config.ts')});
const env={...process.env,MAKEFLAGS:(process.env.MAKEFLAGS||'').split(' -- ')[0]};for(const key of ['MAKEOVERRIDES','ARGS','PACKAGE','SCRIPT'])delete env[key];
const log=openSync(resolve(directory,'output.log'),'w');
// The authoritative Make target owns the shared Docker lease, dotenv loading,
// stack provisioning and cleanup. A bare workspace test command bypasses it.
const result=spawnSync('make',['test-e2e','PACKAGE=web-e2e'],{cwd:root,env,stdio:['ignore',log,log]});closeSync(log);
writeFileSync(resolve(directory,'result.json'),JSON.stringify({code:result.status,signal:result.signal,command:['make','test-e2e','PACKAGE=web-e2e'],normalCoverageProducer:false,environmentFilePresent:existsSync(resolve(root,'apps/web-e2e/.env')),prerequisites:'determined by authoritative owned-stack preflight after dotenv loading; see output.log'},null,2));
console.log(directory,result.status);process.exitCode=result.status??1;
