import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {openSync,closeSync,mkdtempSync} from 'node:fs';
import {spawn} from 'node:child_process';
const out=process.env.EXPERIMENT_REPO_OUTPUT_ROOT||'/tmp/wallpaperdb-742/repo-wide';
const matrix=JSON.parse(await readFile(out+'/matrix.json','utf8'));
const ids=process.argv.slice(2);
async function run(row,mode) {
 const directory=`${out}/runs/${row.id}`;await mkdir(directory,{recursive:true});
 const launch=mkdtempSync(`${directory}/${mode}-launch-`);
 const path=`${launch}/output.log`,fd=openSync(path,'w'),start=Date.now();
 const target=`make run PACKAGE=root SCRIPT=experiment:coverage:repo ARGS="${row.id} ${mode}"`;
 const args=row.containers?['docker-run',`ARGS=${target}`]:['run','PACKAGE=root','SCRIPT=experiment:coverage:repo',`ARGS=${row.id} ${mode}`];
 const code=await new Promise((resolve,reject)=>{const p=spawn('make',args,{env:{...process.env,EXPERIMENT_REPO_LAUNCH_LOG:path,EXPERIMENT_REPO_LAUNCH_DIRECTORY:launch},stdio:['ignore',fd,fd]});p.once('error',reject);p.once('exit',(code,signal)=>resolve({code,signal}));});closeSync(fd);
 let attemptDirectory=null;try{attemptDirectory=JSON.parse(await readFile(`${launch}/attempt.json`,'utf8')).directory;}catch(error){if(error.code!=='ENOENT')throw error;}
 const result={id:row.id,mode,...code,seconds:(Date.now()-start)/1000,command:['make',...args],log:path,attemptDirectory};
 await writeFile(`${launch}/run.json`,JSON.stringify(result,null,2));
 await writeFile(`${directory}/${mode}-run.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));return result;
}
for(const id of ids) {
 const row=matrix.tiers.find(r=>r.id===id);if(!row)throw new Error('Unknown configured tier '+id);
 if(row.strategy==='original-playwright') {console.log('Playwright row requires the existing Make E2E path, not this Vitest adapter');continue;}
 const candidate=await run(row,'candidate');if(candidate.code!==0) await run(row,'baseline');
}
