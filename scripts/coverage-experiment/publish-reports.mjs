import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {normalizeVitestCoverage,validateFileCoverage,isEmptyCoverage} from '../lib/coverage-validation.ts';
const require=createRequire(import.meta.url),provider=createRequire(require.resolve('@vitest/coverage-v8'));
const istanbul=createRequire(new URL('../package.json',import.meta.url))('istanbul-lib-coverage');
const report=provider('@vitest/istanbul-lib-report'),reporters=provider('istanbul-reports');
export function coverageMap(data){
 const normalized=structuredClone(Object.fromEntries(Object.entries(data).map(([path,file])=>[path,typeof file.toJSON==='function'?file.toJSON():file])));
 for(const [path,file]of Object.entries(normalized)){
  normalizeVitestCoverage(file);validateFileCoverage(file);
  // The existing CRAP consumer treats the empty-report marker as unavailable,
  // not as a measured function. Keep the original file in the aggregate.
  if(isEmptyCoverage(file))normalized[path]={...file,fnMap:{},branchMap:{},f:{},b:{}};
 }
 return istanbul.createCoverageMap(normalized);
}
export async function publishReports(data,directory){
 const map=coverageMap(data);await mkdir(directory,{recursive:true});
 // Keep the producer's original maps in tier JSON. Counts are the same ones
 // used by all renderers; format normalization matches the normal CRAP reader.
 await writeFile(directory+'/coverage-final.json',JSON.stringify(data));
 const context=report.createContext({dir:directory,coverageMap:map});
 for(const name of ['lcovonly','json-summary','html'])reporters.create(name).execute(context);
 return map;
}
