import json,hashlib,datetime,collections,math
from pathlib import Path
root=Path(__file__).parent
out=root/'failure-screen-v2-file-review-v1';out.mkdir(exist_ok=False)
run=root/'full-million-four-methods-v2'
hashes={}
def read(name):
 b=(run/name).read_bytes();hashes[name]=hashlib.sha256(b).hexdigest();return b
benchmark=json.loads(read('benchmark.json'))
raw=read('requests.jsonl');rows=[json.loads(line) for line in raw.splitlines()]
assert benchmark.get('interruption') and not benchmark.get('finishedAt')
failed=[r for r in rows if r.get('error')];assert failed
pending=[r for r in rows if r.get('profileId')==failed[0]['profileId']]
assert len(pending)==12285 and len(failed)==7491
errors=collections.Counter(r['error'] for r in failed)
def stats(xs):
 xs=sorted(xs)
 return {'count':len(xs),'min':xs[0] if xs else None,'p50':xs[math.ceil(len(xs)*.5)-1] if xs else None,'p95':xs[math.ceil(len(xs)*.95)-1] if xs else None,'max':xs[-1] if xs else None}
bins=[]
for start in range(0,len(pending),1000):
 part=[r for r in pending if start<=r['ordinal']<start+1000]
 bins.append({'ordinalStart':start,'count':len(part),'errors':sum(bool(r.get('error')) for r in part),'latencyMs':stats([r['elapsedMs'] for r in part])})
resources=[json.loads(line) for line in read('resources.jsonl').splitlines()]
selected=[r for r in resources if r['at']>='2026-09-23T18:00:50']
timeline=[]
for r in selected:
 n=next(iter(r['nodes'].values()));search=n['indices']['search'];jvm=n['jvm'];pool=n['thread_pool']['search']
 timeline.append({'at':r['at'],'profileId':r['profileId'],'heapUsedBytes':jvm['mem']['heap_used_in_bytes'],'heapPercent':jvm['mem']['heap_used_percent'],'oldHeapBytes':jvm['mem']['pools']['old']['used_in_bytes'],'openContexts':search['open_contexts'],'pitCurrent':search['point_in_time_current'],'pitTotal':search['point_in_time_total'],'queryCurrent':search['query_current'],'fetchCurrent':search['fetch_current'],'queue':pool['queue'],'rejected':pool['rejected'],'clientRss':r['clientMemory']['rss']})
observer=[]
for line in (root/'resources-v3/resources.jsonl').open():
 try:r=json.loads(line)
 except json.JSONDecodeError:break
 if '2026-09-23T18:00:50'<=r['at']<='2026-09-23T18:01:25':observer.append(r)
def kv(s):return {a:int(b) for a,b in (row.split() for row in s.splitlines())}
first,last=observer[0]['cgroup'],observer[-1]['cgroup']
eventkeys=kv(first['memory.events']);eventdelta={k:kv(last['memory.events'])[k]-v for k,v in eventkeys.items()}
profilecounts=collections.Counter(r['profileId'] for r in rows if r['phase']=='timed')
first_error_position=next(i for i,r in enumerate(pending) if r.get('error'))
result={'schemaVersion':1,'experiment':'favorite-failed-screen-file-diagnosis','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'fileOnly':True,'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'inputHashes':hashes,
 'screenInterruptedAt':benchmark['interruption']['at'],'interruption':benchmark['interruption'],'completeProfiles':len(benchmark['profiles']),'timedRequestsByProfile':dict(profilecounts),
 'failingProfile':failed[0]['profileId'],'pendingTrials':len(pending),'pendingErrors':len(failed),'pendingSuccesses':len(pending)-len(failed),'errorMessages':dict(errors),
 'firstRecordedError':failed[0],'minimumFailingOrdinal':min(r['ordinal'] for r in failed),'lastRecordedError':failed[-1],'lastRecordedSuccess':next(r for r in reversed(pending) if not r.get('error')),
 'successesRecordedAfterFirstError':sum(not r.get('error') for r in pending[first_error_position+1:]),'strictOverOneSecond':sum(r['elapsedMs']>=1000 for r in pending),'failedLatencyMs':stats([r['elapsedMs'] for r in failed]),'successfulLatencyMs':stats([r['elapsedMs'] for r in pending if not r.get('error')]),'ordinalBins':bins,
 'nodeTimeline':timeline,'kernelInterval':{'firstAt':observer[0]['at'],'lastAt':observer[-1]['at'],'samples':len(observer),'memoryEventDelta':eventdelta,'memoryChargeBytes':stats([int(r['cgroup']['memory.current']) for r in observer]),'swapBytes':stats([int(r['cgroup']['memory.swap.current']) for r in observer])},
 'conclusion':'Intermittent fast transport failures during maxima C16; successful searches and resource reads continue between failures. Saved data does not show a node crash, search rejection, OOM or sustained JVM heap pressure. Exact transport cause remains unproven.',
 'limitations':['Per-trial raw rows lack wall timestamps and nested transport causes; earliest exact request-error UTC cannot be recovered.','Saved process metrics do not include JVM/client/proxy file-descriptor counts or TCP/conntrack counters.','PIT/open_contexts rose above16 after transport failures; saved observations alone do not establish whether cleanup failures caused or followed connection errors.','This is a failed incomplete capacity campaign; successful-only latencies do not make its pending profile viable.','File-only resource summarization and audit reads overlapped this screen; known small observer reads were separately reported to root.']}
(out/'kernel-window.json').write_text(json.dumps(observer))
(out/'diagnosis.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['failingProfile','pendingTrials','pendingErrors','pendingSuccesses','minimumFailingOrdinal','successesRecordedAfterFirstError','strictOverOneSecond','failedLatencyMs','successfulLatencyMs']}))
print('output',str(out/'diagnosis.json'))
