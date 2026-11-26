import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const root=process.env.EXPERIMENT_REPO_ROOT;
const require=createRequire(resolve(root,'package.json'));
const {loadConfigFromFile}=await import(pathToFileURL(createRequire(require.resolve('vitest')).resolve('vite')).href);
export default async function(environment) {
 const configFile=process.env.EXPERIMENT_REPO_CONFIG;
 const loaded=await loadConfigFromFile({command:'serve',mode:'test'},configFile);
 if(!loaded) throw new Error('Could not load configured tier: '+configFile);
 const base=loaded.config;
 const native=process.env.EXPERIMENT_REPO_STRATEGY==='compiled-native';
 const rewrite=value=>Array.isArray(value)?value.map(rewrite):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)])):typeof value==='string'?value.replace(/\.tsx?\b/g,'.js').replace('{ts,tsx}','js'):value;
 // Only test selection/setup paths and coverage paths change representation.
 // Keep plugins, aliases, environments, projects, assertions and lifecycle budgets.
 const test={...base.test};
 if(native) {
  for(const k of ['include','exclude','setupFiles','globalSetup'])if(test[k])test[k]=rewrite(test[k]);
  if(test.projects)test.projects=test.projects.map(p=>typeof p==='string'?rewrite(p):{...p,test:{...p.test,experimental:{...p.test?.experimental,viteModuleRunner:false,nodeLoader:true},...Object.fromEntries(['include','exclude','setupFiles','globalSetup'].filter(k=>p.test?.[k]).map(k=>[k,rewrite(p.test[k])]))}});
  test.experimental={...test.experimental,viteModuleRunner:false,nodeLoader:true};
 }
 test.coverage={...test.coverage,...(native?{autoAttachSubprocess:true}:{}),reporter:test.coverage?.reporter||['json','json-summary','lcov'],reportsDirectory:resolve(process.env.EXPERIMENT_REPO_OUTPUT,'coverage')};
 const originalCoverage={reportsDirectory:base.test?.coverage?.reportsDirectory,include:base.test?.coverage?.include,exclude:base.test?.coverage?.exclude};
 if(native)for(const k of ['include','exclude'])if(test.coverage[k])test.coverage[k]=rewrite(test.coverage[k]).map(p=>p.replaceAll('.js','.{js,mjs,cjs}'));
 await writeFile(resolve(process.env.EXPERIMENT_REPO_OUTPUT,'selection.json'),JSON.stringify({root:process.cwd(),strategy:process.env.EXPERIMENT_REPO_STRATEGY,configFile,originalCoverage,test},(_,v)=>typeof v==='function'?'[function preserved]':v,2));
 return {...base,root:process.cwd(),test:{...test,reporters:['default','json'],outputFile:{json:resolve(process.env.EXPERIMENT_REPO_OUTPUT,'tests.json')}}};
}
