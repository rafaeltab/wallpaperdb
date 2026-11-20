import {beginAttempt} from "./repo-artifacts.mjs";
import {readFile,mkdir} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const evidenceRoot=process.env.EXPERIMENT_REPO_OUTPUT_ROOT||'/tmp/wallpaperdb-742/repo-wide';
const {tiers}=JSON.parse(await readFile(evidenceRoot+'/matrix.json','utf8'));
const id=process.argv[2],mode=process.argv[3]||'candidate',row=tiers.find(r=>r.id===id);
if(!row||!['candidate','baseline'].includes(mode)||row.strategy==='original-playwright')throw new Error('Select a configured Vitest row and mode');
const strategy=mode==='baseline'?'source-vite':row.strategy;
const focus=process.env.EXPERIMENT_REPO_FILTER;
const baseOutput=resolve(evidenceRoot,'runs',id,mode+(focus?'-focus':''));
const output=beginAttempt(baseOutput,root,{id,mode,strategy,config:resolve(strategy==='compiled-native'?resolve(root,'.coverage-experiment/build',row.runtime):resolve(root,row.runtime),strategy==='compiled-native'?row.config.replace(/\.tsx?$/,'.js'):row.config),sourceConfig:resolve(root,row.runtime,row.config)});
const source=resolve(root,row.runtime),cwd=strategy==='compiled-native'?resolve(root,'.coverage-experiment/build',row.runtime):source;
Object.assign(process.env,{EXPERIMENT_REPO_ROOT:root,EXPERIMENT_REPO_CONFIG:resolve(cwd,strategy==='compiled-native'?row.config.replace(/\.tsx?$/,'.js'):row.config),EXPERIMENT_REPO_OUTPUT:output,EXPERIMENT_REPO_STRATEGY:strategy});
if(mode==='candidate'){
 const hook=strategy==='compiled-native'?'native-hook.mjs':'redirect.mjs';
 process.env.EXPERIMENT_NATIVE_SOURCES=mkdtempSync(resolve(root,'.coverage-experiment/native-sources-'));
 process.env.NODE_OPTIONS=`${process.env.NODE_OPTIONS||''} --import=${JSON.stringify(resolve(root,'scripts/coverage-experiment',hook))}`;
 await import(new URL(hook,import.meta.url));
}
const require=createRequire(resolve(source,'package.json'));
const cli=resolve(dirname(require.resolve('vitest/package.json')),'vitest.mjs');
// Make's command-line selectors belong to this launcher, not the nested
// Make contracts exercised by the tests. Preserve normal flags and lease env.
process.env.MAKEFLAGS=(process.env.MAKEFLAGS||'').split(' -- ')[0];
delete process.env.MAKEOVERRIDES;
for(const key of ['ARGS','PACKAGE','SCRIPT','COVERAGE_MODE','COVERAGE_DELIVERY'])delete process.env[key];
process.chdir(cwd);
process.argv=[process.execPath,cli,'run','--config',resolve(root,'scripts/coverage-experiment/repo.config.mjs'),...(focus?[focus]:[]),...row.args.map(arg=>arg.startsWith('--coverage.reportsDirectory=')?`--coverage.reportsDirectory=${resolve(output,'coverage')}`:arg)];
await import(pathToFileURL(cli).href);
