import datetime,gzip,hashlib,json,math,pathlib
root=pathlib.Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23')
p=root/'resources-indexing-completed-v1';report=json.loads((p/'resources-summary.json').read_text()); status=json.loads((p/'build-status.json').read_text())
hashbytes=lambda b:hashlib.sha256(b).hexdigest()
epoch=lambda t:datetime.datetime.fromisoformat(t.replace('Z','+00:00')).timestamp()
assert hashbytes((p/'build-status.json').read_bytes())==report['buildStatus']['sha256']
assert hashbytes((p/'summary-source.py').read_bytes())==report['sourceSha256']
assert hashbytes((p/'observer-source.py').read_bytes())==report['observer']['sourceSha256']
assert hashbytes((p/'observer.json').read_bytes())==report['observer']['metadataSha256']
raw=gzip.decompress((p/'observer-prefix.jsonl.gz').read_bytes());assert hashbytes(raw)==report['observer']['completePrefixSha256'];assert len(raw)==report['observer']['completePrefixBytes']
allrows=[json.loads(line) for line in raw.splitlines() if line];assert len(allrows)==report['observer']['sampleCount']
assert all(epoch(a['at'])<=epoch(b['at']) for a,b in zip(allrows,allrows[1:]))
phase=next(x for x in status['phases'] if x['id']=='points-full-1m-index');audit=next(x for x in status['phases'] if x['id']=='points-full-1m-audit')
assert phase['exitCode']==0;assert epoch(phase['finishedAt'])<epoch(audit['startedAt'])
assert len(report['indexing'])==1 and report['campaigns']==[]
r=report['indexing'][0];interval=r['interval'];start=epoch(phase['startedAt']);end=epoch(phase['finishedAt'])
rows=[x for x in allrows if start<=epoch(x['at'])<=end];assert len(rows)==interval['samples'];assert interval['requestedStart']==phase['startedAt'];assert interval['requestedEnd']==phase['finishedAt'];assert interval['phaseComplete'] is True
assert all(epoch(x['at'])<epoch(audit['startedAt']) for x in rows)
seconds=epoch(rows[-1]['at'])-epoch(rows[0]['at']);assert seconds==interval['observedSeconds'];assert interval['fractionCoveredByCounterWindow']==seconds/(end-start)
assert interval['firstObservedAt']==rows[0]['at'];assert interval['lastObservedAt']==rows[-1]['at']
assert interval['unobservedStartSeconds']==epoch(rows[0]['at'])-start;assert interval['unobservedEndSeconds']==end-epoch(rows[-1]['at'])
parse=lambda text:dict((line.split()[0],int(line.split()[1])) for line in text.splitlines())
stats={key:[parse(row['cgroup'][key]) for row in rows] for key in ['cpu.stat','memory.stat','memory.events']}
def check_delta(actual,values):
 valid=len(values)>=2 and all(v is not None for v in values) and all(a<=b for a,b in zip(values,values[1:]) if a is not None and b is not None)
 assert actual['valid']==valid
 assert actual['delta']==(values[-1]-values[0] if valid else None)
def check_gauge(actual,values):
 valid=[x for x in values if x is not None];assert actual['first']==values[0];assert actual['last']==values[-1];assert actual['sampledMinimum']==min(valid);assert actual['sampledMaximum']==max(valid);assert actual['validSamples']==len(valid)
for key in ['usage_usec','user_usec','system_usec','nr_periods','nr_throttled','throttled_usec']:check_delta(r['cgroupCpu'][key],[x.get(key) for x in stats['cpu.stat']])
usage=stats['cpu.stat'][-1]['usage_usec']-stats['cpu.stat'][0]['usage_usec'];assert r['cgroupCpu']['meanCores']==usage/1e6/seconds;assert {x['cgroup']['cpu.max'] for x in rows}=={'800000 100000'};assert r['cgroupCpu']['quotaCores']==8;assert r['cgroupCpu']['meanFractionOfQuota']==usage/1e6/seconds/8
for target,key in [('memoryChargeBytes','memory.current'),('swapChargeBytes','memory.swap.current'),('limitBytes','memory.max'),('cgroupLifetimePeakBytes','memory.peak')]:check_gauge(r['cgroupMemory'][target],[int(x['cgroup'][key]) for x in rows])
for key in ['anon','file','kernel','file_mapped','file_dirty','file_writeback','shmem','swapcached']:check_gauge(r['cgroupMemory'][key+'Bytes'],[x.get(key) for x in stats['memory.stat']])
for key in r['cgroupMemory']['events']:check_delta(r['cgroupMemory']['events'][key],[x.get(key) for x in stats['memory.events']])
for key in r['cgroupMemory']['activityCounters']:check_delta(r['cgroupMemory']['activityCounters'][key],[x.get(key) for x in stats['memory.stat']])
def mapcounter(text):
 out={}
 for line in text.splitlines():
  words=line.split();out[words[0]]={k:float(v) for k,v in (p.split('=') for p in words[1:])}
 return out
io=[mapcounter(x['cgroup']['io.stat']) for x in rows]
assert set(r['cgroupIoByDevice'])==set().union(*(x.keys() for x in io));assert not any('totalIo' in k for k in r)
for device,values in r['cgroupIoByDevice'].items():
 for key,value in values.items():check_delta(value,[x.get(device,{}).get(key) for x in io])
for location,access in [('cgroupPressure',lambda x,k:x['cgroup'][k+'.pressure']),('hostPressure',lambda x,k:x['hostPressure'][k])]:
 for kind in ['cpu','memory','io']:
  values=[mapcounter(access(x,kind)) for x in rows]
  for level in ['some','full']:
   actual=r[location][kind][level];numbers=[x.get(level,{}).get('total') for x in values];check_delta(actual['totalMicroseconds'],numbers)
   assert actual['fractionOfObservedWallTime']==(numbers[-1]-numbers[0])/1e6/seconds
result={'schemaVersion':1,'experiment':'independent-final-indexing-resource-review','passed':True,'sourceSha256':report['sourceSha256'],'summarySha256':hashbytes((p/'resources-summary.json').read_bytes()),'archivedPrefixSha256':hashbytes(raw),'requestedStart':phase['startedAt'],'requestedEnd':phase['finishedAt'],'valueAuditStart':audit['startedAt'],'samples':len(rows),'observedSeconds':seconds,'phaseComplete':True,'auditAndSearchExcluded':True,'meanCgroupCores':usage/1e6/seconds,'meanFractionOfEightCoreQuota':r['cgroupCpu']['meanFractionOfQuota'],'memory':{k:r['cgroupMemory'][k] for k in ['memoryChargeBytes','anonBytes','fileBytes','swapChargeBytes','cgroupLifetimePeakBytes']},'memoryEvents':r['cgroupMemory']['events'],'ioByDevice':r['cgroupIoByDevice'],'pressureFractions':{kind:{level:r['cgroupPressure'][kind][level]['fractionOfObservedWallTime'] for level in ['some','full']} for kind in ['cpu','memory','io']},'limitations':['Temporal indexing-command attribution includes preparation, indexing, merges, refresh/finalization and container background work.','Cgroup charge, anon, file cache and swap are distinct; gauge maxima need not be simultaneous.','memory.peak is lifetime; reported per-phase peaks are sampled. Entrypoint RSS is not JVM RSS.','Layered devices may account for the same IO; never add their byte deltas.','No search capacity or per-request memory conclusion follows from indexing resources.']}
(root/'resources-indexing-completed-independent-audit-v1.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['passed','samples','observedSeconds','meanCgroupCores','requestedEnd','valueAuditStart','auditAndSearchExcluded']}))
