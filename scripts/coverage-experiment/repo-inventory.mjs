import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),yaml=createRequire(require.resolve('vitest'))('yaml');
const patterns=yaml.parse(await readFile('pnpm-workspace.yaml','utf8')).packages;
const dirs=['.'];const absent=[];
for(const pattern of patterns) {
 if(pattern.endsWith('/*')) {const parent=pattern.slice(0,-2);if(!existsSync(parent)){absent.push(pattern);continue;}for(const item of await readdir(parent))if(existsSync(`${parent}/${item}/package.json`))dirs.push(`${parent}/${item}`);}
 else if(existsSync(`${pattern}/package.json`))dirs.push(pattern);
}
const workspaces=[],tiers=[];
for(const directory of dirs) {
 const pkg=JSON.parse(await readFile(`${directory}/package.json`,'utf8'));
 const scripts=pkg.scripts||{},selected=['test:unit','test:integration','test:e2e','test:coverage','test:all'].filter(key=>scripts[key]);
 workspaces.push({directory,name:pkg.name,scripts,quality:existsSync(`${directory}/quality.config.json`),testStatus:selected.length?'configured tests':'N/A: no maintained test script/config',aliases:Object.fromEntries(Object.entries(scripts).filter(([k])=>['test','test:watch','test:ui','test:browser','test:e2e:ui','test:e2e:headed'].includes(k)))});
 for(const tier of selected) {
  const command=scripts[tier];let part=0;
  for(const chunk of command.split('&&').map(s=>s.trim())) {
   const match=chunk.match(/(?:^|\/)vitest\s+(.*)$/);
   if(!match)continue;
   const args=match[1].split(/\s+/).filter(a=>a!=='run');
   const config=args.includes('--config')?args[args.indexOf('--config')+1]:'vitest.config.ts';
   const runtime=directory==='scripts'?'.':directory;
   const sourceVite=['.','scripts','infra','apps/web','apps/web-e2e','packages/react-muuri','packages/crap-typescript-core','packages/biome-test-rules'].includes(directory)||config.startsWith('frontend/')||(directory==='apps/factory'&&tier==='test:e2e');
   tiers.push({id:`${directory==='.'?'root':directory.replaceAll('/','-')}-${tier.replace('test:','')}-${++part}`,workspace:directory,runtime,script:tier,command,config,args:args.filter((a,i)=>a!=='--config'&&args[i-1]!=='--config'),strategy:sourceVite?'source-vite':'compiled-native',coverage:args.includes('--coverage')||directory==='apps/web'&&config==='vitest.browser.config.ts',containers:directory!=='apps/factory' && (tier.includes('integration')||tier.includes('e2e')||tier==='test:all'||directory==='packages/url-ipv4-resolver'),overlap:tier==='test:all'?'combined config overlaps unit/integration; distinct configured producer':null});
  }
  if(command.includes('playwright test'))tiers.push({id:'apps-web-e2e-e2e',workspace:directory,runtime:directory,script:tier,command,strategy:'original-playwright',coverage:false,containers:true});
 }
}
const output=process.env.EXPERIMENT_REPO_OUTPUT_ROOT||'/tmp/wallpaperdb-742/repo-wide';
await mkdir(output,{recursive:true});
await writeFile(output+'/matrix.json',JSON.stringify({patterns,absent,workspaces,tiers},null,2));
console.log(`${workspaces.length} workspaces; ${tiers.length} actual configured invocations; absent ${absent.join(', ')}`);
