import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { loadExpandedCorpus, prepareRealIndex, INDEX, STORE, hash } from './service.mjs';

const [command, ...args] = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
try {
  if (command === 'index') console.log(JSON.stringify(await prepareRealIndex(option('--index', INDEX)), null, 2));
  else if (command === 'evaluate') {
    const { METHODS, indexForMethod } = await import('./registry.mjs');
    const { executeRun } = await import('../evaluation/loop/runner.mjs');
    const selected = option('--methods')?.split(',');
    const methods = METHODS.filter(m => !selected || selected.includes(m.id));
    if (!methods.length || selected?.some(id => !METHODS.some(m => m.id === id))) throw Error('Unknown or empty method selection');
    let config = { schemaVersion: 1,
      label: option('--label', 'Service-backed color methods: full real corpus'),
      description: 'All source wallpapers plus all supplied ZIP members. Runtime ranking and filtering run in the declared search service. Single-observer development judgments; unjudged new results remain unjudged.',
      workload: { warmup: 1, repeats: Number(option('--repeats', '5')), concurrency: Number(option('--concurrency', '1')), limit: 20, accuracyLimit: 1000, timeoutMs: 10000 },
      candidates: methods.map(m => ({ id: m.id, method: m.id, label: m.label, module: './adapter.mjs', ...(m.engine === 'clickhouse' ? {} : { index: indexForMethod(m, option('--index', INDEX)) }) })),
    };
    if(option('--config')) config=JSON.parse(await readFile(path.resolve(option('--config')),'utf8'));
    const sourceDirectory=path.dirname(fileURLToPath(import.meta.url));
    const sources=Object.fromEntries(await Promise.all((await readdir(sourceDirectory)).filter(f=>f.endsWith('.mjs')).sort().map(async f=>[f,await readFile(path.join(sourceDirectory,f),'utf8')])));
    const sourceSnapshotHash=hash(sources),snapshotPath=path.join(STORE,'source-snapshots',`${sourceSnapshotHash}.json`);
    await mkdir(path.dirname(snapshotPath),{recursive:true});
    try{await writeFile(snapshotPath,JSON.stringify(sources,null,2),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
    config.sourceSnapshot={sha256:sourceSnapshotHash,path:snapshotPath};
    const { run, directory } = await executeRun({ config, configDirectory: sourceDirectory, corpus: await loadExpandedCorpus(), onProgress: console.log });
    console.log(`REPORT ${directory}/report.html`);
    for (const candidate of run.candidates) console.log(JSON.stringify({ id: candidate.id, coverage: candidate.summary.coverage, accuracy: candidate.summary.accuracy.allPairs, performance: { ...candidate.summary.performance, samplesMs: undefined } }));
    if (run.candidates.some(c => c.summary.coverage.error || c.summary.performance.failures)) process.exitCode = 1;
  } else if (command === 'browser') await import('./browser-cli.mjs');
  else throw Error('Usage: cli.mjs index | evaluate [--methods IDs --repeats N --concurrency N --label TEXT] | browser');
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
