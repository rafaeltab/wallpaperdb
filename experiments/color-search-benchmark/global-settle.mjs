import {api,readJson,saveJson,waitForIdle} from './global-common.mjs';
await waitForIdle();
for(const path of ['global-indexing.json','global-multi-indexing.json']){
  const report=await readJson(path);
  for(const row of report.indexes){
    row.fingerprint??=report.fingerprint;
    row.statsAfterQuiescence=(await api(`/${row.index}/_stats/docs,store,segments,indexing`)).body._all.primaries;
    console.log(`${row.index}: ${(row.statsAfterQuiescence.store.size_in_bytes/1024/1024).toFixed(1)} MiB after merges settled.`);
  }
  report.quiescentStatsAt=new Date().toISOString();await saveJson(path,report);
}
