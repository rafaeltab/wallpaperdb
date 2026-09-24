import json, hashlib, math, collections, datetime
from pathlib import Path
ROOT=Path('/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark')
D=Path(__file__).parent
errors=[];checks=0

def ck(value,message):
 global checks
 checks+=1
 if not value: errors.append(message)
def sha(b): return hashlib.sha256(b).hexdigest()
def js(v): return json.dumps(v,ensure_ascii=False,separators=(',',':'))
def fail(x): return bool(x.get('error')) or x['elapsedMs']>=1000

def pct(values,p):
 return sorted(values)[max(0,math.ceil(len(values)*p)-1)] if values else None
rbytes=(D/'scale.json').read_bytes();r=json.loads(rbytes)
ck(bool(r.get('finishedAt')) and not r.get('interruptions'),'campaign completion')
ck(r['configuration']['counts']==[100000,1000000],'counts')
ck(r['configuration']['requests']==32 and r['configuration']['durationSeconds']==10,'measurement bounds')
ck(r['configuration']['concurrencies']==[1,4,16],'concurrencies')
ck(r['scope']=='projection' and not r['fullSchema'] and not r['projection']['fullIndexCapacityMeasured'],'projection interpretation')
ck(r['source']['sourceCount']==523 and r['source']['verifiedOriginalCount']==545 and r['source']['excludedFixtureCount']==22,'cohorts')
snapshot_path=ROOT/'exploration/snapshots/strict-hue-favorite-001.json'
snapshot=json.loads(snapshot_path.read_bytes())
ck(sha(snapshot_path.read_bytes())==r['source']['snapshotManifestHash'],'favorite manifest hash')
ck(sha(Path(snapshot['sourceArchive']['path']).read_bytes())==r['source']['sourceArchiveHash'],'snapshot archive hash')
ck(sha(Path(snapshot['sourceArchive']['inventory']['path']).read_bytes())==r['source']['sourceInventoryHash'],'snapshot inventory hash')
source=json.loads((D/'source-snapshot.json').read_text())
ck(sha(js(source).encode())==r['sourceSnapshotHash'],'source snapshot content hash')
for f,content in source.items():
 ck((ROOT/f).read_text()==content,'frozen current source '+f)
 ck(sha(content.encode())==r['sourceHashes'][f]==r['identity']['sourceHashes'][f],'source hash '+f)
for f,h in r['source']['sourceHashes'].items(): ck(sha((ROOT/'exploration'/f).read_bytes())==h==snapshot['measurements']['sourceHashes'][f],'extraction source '+f)
for receipt in r['source']['receipts']:
 saved=next(x for x in snapshot['measurements']['indices'] if x['bucketCount']==receipt['bucketCount'])
 ck(sha(Path(saved['receipt']['path']).read_bytes())==receipt['receiptSha256'],'receipt bytes')
 ck(receipt['valuesHash']==saved['valuesHash'] and receipt['anchorsHash']==saved['anchorsHash'],'strict hue values')
ck(r['finalIndexStats']['primaries']['docs']['count']==1000000 and r['finalIndexStats']['primaries']['docs']['deleted']==0,'million final docs no overwrite')
ck(len(r['projection']['fields'])==70 and all(x.startswith(('cov_','quality_')) for x in r['projection']['fields']),'70 measurement fields')
ck(len(r['queryPlans'])==24 and len(r['workload'])==24,'24 workload cases')
for plan in r['queryPlans']:
 body=plan['body'];dump=js(body)
 ck(body['size']==20 and body['_source']==False and body['track_total_hits']==False and body['timeout']=='950ms','query controls '+plan['caseId'])
 ck(body['sort']==[{'_score':'desc'},{'id':'asc'}] and 'terminate_after' not in body and 'rescore' not in body and 'script_score' not in dump,'global native rank '+plan['caseId'])
 ck(set(plan['requiredFields'])<=set(r['projection']['fields']),'projection completeness')
 ck(plan['componentCount'] in [5,10,25],'cutoff components')
profiles={p['id']:p for p in r['profiles']};warmups={w['id']:w for w in r['warmups']}
ck(len(profiles)==140 and len(warmups)==48,'profile/warmup count')
ck(collections.Counter(p['count'] for p in profiles.values())=={100000:72,1000000:68},'profile stages')
seen={pid:bytearray(len(p['trials'])) for pid,p in profiles.items()};seenwarm=collections.Counter();rawcounts=collections.Counter();rawhash=hashlib.sha256();rawbytes=0
context=['invocationId','count','caseId','variant','queryId','selectivity','method','parameters','concurrency']
compact=['ordinal','elapsedMs','serviceTookMs','hitCount','overOneSecond','error']
with (D/'requests.jsonl').open('rb') as fh:
 for n,line in enumerate(fh,1):
  rawhash.update(line);rawbytes+=len(line);x=json.loads(line);rawcounts[x['phase']]+=1
  if x['phase']=='timed':
   p=profiles.get(x.get('profileId'));ck(p is not None,'unknown raw profile '+str(n))
   if p is None: continue
   o=x['ordinal'];ck(isinstance(o,int) and 0<=o<len(p['trials']),'raw ordinal bounds '+str(n))
   if not isinstance(o,int) or not 0<=o<len(p['trials']):continue
   ck(not seen[p['id']][o],'duplicate ordinal '+str(n));seen[p['id']][o]=1
   ck(all(x.get(k)==p.get(k) for k in context),'raw profile context '+str(n))
   ck({k:x[k] for k in compact if k in x}==p['trials'][o],'raw compact parity '+str(n))
   ck(x['requestId']==p['id']+':timed:'+str(o),'request id '+str(n))
  elif x['phase']=='warmup':
   w=warmups.get(x.get('warmupId'));ck(w is not None,'unknown warmup')
   if w is None:continue
   seenwarm[w['id']]+=1
   ck({k:v for k,v in x.items() if k!='hits'}==w['trials'][x['ordinal']],'raw warmup parity')
   ck(x['requestId']==w['id']+':warmup:'+str(x['ordinal']),'warmup request id')
  else:ck(False,'unexpected raw phase')
  ck(math.isfinite(x['elapsedMs']) and x['elapsedMs']>=0,'finite raw latency '+str(n))
  ck(x['overOneSecond']==(x['elapsedMs']>=1000),'raw threshold '+str(n))
  ck(x['hitCount']==(0 if x.get('error') else 20),'raw top20 '+str(n))
  if n%200000==0:print('audited raw',n,flush=True)
for pid,bits in seen.items():ck(all(bits),'raw completeness '+pid)
for wid,w in warmups.items():ck(seenwarm[wid]==len(w['trials']),'warmup completeness '+wid)
rows=[];totals=collections.Counter()
for p in profiles.values():
 t=p['trials'];w=[x for wid in p['warmupIds'] for x in warmups[wid]['trials']]
 ck([x['ordinal'] for x in t]==list(range(len(t))),'profile ordinals '+p['id'])
 good=[x['elapsedMs'] for x in t if not x.get('error')]
 expected={'requests':len(t),'p50Ms':pct(good,.5),'p95Ms':pct(good,.95),'p99Ms':pct(good,.99),'maxMs':max(x['elapsedMs'] for x in t),'errors':sum(bool(x.get('error')) for x in t),'overOneSecond':sum(x['elapsedMs']>=1000 for x in t),'warmupErrors':sum(bool(x.get('error')) for x in w),'warmupOverOneSecond':sum(x['elapsedMs']>=1000 for x in w),'strictTimedFailures':sum(fail(x) for x in t),'strictWarmupFailures':sum(fail(x) for x in w),'timedRequestsViable':not any(fail(x) for x in t),'viableAtTestedLoad':bool(w) and not any(fail(x) for x in t+w)}
 ck(all(p[k]==v for k,v in expected.items()),'profile statistics '+p['id'])
 ck(len(t)>=32 and p['elapsedMs']>=10000 and p['minimumRequests']==32 and p['requestedDurationMs']==10000,'profile minimum duration '+p['id'])
 ck(math.isclose(p['throughputPerSecond'],len(t)/(p['elapsedMs']/1000),rel_tol=1e-14),'throughput '+p['id'])
 ck(p['parameters']['qualityCurve']=='linear' and p['parameters']['qualityInfluence']==.5 and p['parameters']['cutoffBlendExponent']==1 and p['parameters']['bucketCount'] in [256,1024],'favorite settings '+p['id'])
 totals.update({'timed':len(t),'errors':expected['errors'],'slow':expected['overOneSecond'],'failureUnion':expected['strictTimedFailures'],'passingProfiles':int(expected['viableAtTestedLoad'])})
 rows.append({k:p[k] for k in ['count','caseId','queryId','selectivity','concurrency','requests','p50Ms','p95Ms','p99Ms','maxMs','errors','overOneSecond','strictTimedFailures','warmupErrors','warmupOverOneSecond','viableAtTestedLoad','throughputPerSecond','cpuMs','clientCpuMs','peakObservedHeapBytes','peakObservedClientRssBytes']})
for count in [100000,1000000]:
 for item in r['workload']:
  ps=sorted([p for p in profiles.values() if p['count']==count and p['caseId']==item['id']],key=lambda x:x['concurrency'])
  ck(bool(ps) and ps[0]['concurrency']==1,'starts atC1')
  for i,p in enumerate(ps):
   ck(p['concurrency']==[1,4,16][i],'no skipped intermediate concurrency')
   if i:ck(ps[i-1]['viableAtTestedLoad'],'higher concurrency after failure')
  missing=[c for c in [1,4,16] if c not in [p['concurrency'] for p in ps]]
  skips=[x for x in r['skipped'] if x.get('count')==count and x.get('caseId')==item['id']]
  ck(missing==[c for x in skips for c in x.get('concurrencies',[])],'skip accounting '+item['id'])
  if missing:ck(not ps[-1]['viableAtTestedLoad'],'skip after failure')
ck(len(r['skipped'])==2 and sum(len(x['concurrencies']) for x in r['skipped'])==4,'4higherC omitted')
for s in r['settling']:
 ck(s['settled'] and len(s['samples'])>=2,'settled')
 ck(all(all(x[k]==0 for k in ['active','queued','queryCurrent','fetchCurrent','merges']) for x in s['samples'][-2:]),'settled search+merge quiet')
resources=[];resource_hash=hashlib.sha256();resourcebytes=0;resourcesByProfile=collections.defaultdict(list)
with (D/'resources.jsonl').open('rb') as fh:
 for line in fh:
  resource_hash.update(line);resourcebytes+=len(line);x=json.loads(line);resources.append(x);resourcesByProfile[x['profileId']].append(x)
for p in profiles.values():
 samples=[p['before']]+resourcesByProfile[p['id']]+[p['after']]
 ck(len(samples)==p['resourceSampleCount'],'resource sample count')
 ck(sum(bool(x.get('error')) for x in samples)==p['resourceErrors'],'resource errors')
 ck(max(sum(node.get('jvm',{}).get('mem',{}).get('heap_used_in_bytes',0) for node in x.get('nodes',{}).values()) for x in samples)==p['peakObservedHeapBytes'],'heap observation')
 ck(max(x.get('clientMemory',{}).get('rss',0) for x in samples)==p['peakObservedClientRssBytes'],'driver rss observation')
 before,after=p['before'],p['after']
 cpu=lambda x:sum(n.get('process',{}).get('cpu',{}).get('total_in_millis',0) for n in x['nodes'].values())
 ck(cpu(after)-cpu(before)==p['cpuMs'],'node CPU delta')
 ck(math.isclose((after['clientCpu']['user']+after['clientCpu']['system']-before['clientCpu']['user']-before['clientCpu']['system'])/1000,p['clientCpuMs'],rel_tol=1e-14),'driverCPUdelta')
ck(sum(rawcounts.values())+len(resources)==r['recording']['totalRows'],'total raw recorder rows')
ck(rawbytes+resourcebytes==r['recording']['totalBytes'],'total raw recorder bytes')
ck(rawcounts['timed']==totals['timed'] and rawcounts['warmup']==48,'raw totals')
summary={'auditedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'auditor':'independent favorite_perf_audit filesystem-only','passed':not errors,'checks':checks,'errors':errors,'artifacts':{'scale.json':{'sha256':sha(rbytes),'bytes':len(rbytes)},'requests.jsonl':{'sha256':rawhash.hexdigest(),'bytes':rawbytes,'rows':sum(rawcounts.values()),'phases':dict(rawcounts)},'resources.jsonl':{'sha256':resource_hash.hexdigest(),'bytes':resourcebytes,'rows':len(resources)},'sourceSnapshotHash':r['sourceSnapshotHash'],'auditScriptSha256':sha(Path(__file__).read_bytes())},'profiles':len(profiles),'profilesByCount':dict(collections.Counter(p['count'] for p in profiles.values())),'strictTotals':dict(totals),'warmupErrors':sum(bool(x.get('error')) for w in warmups.values() for x in w['trials']),'warmupSlow':sum(x['elapsedMs']>=1000 for w in warmups.values() for x in w['trials']),'warmupFailureUnion':sum(fail(x) for w in warmups.values() for x in w['trials']),'higherConcurrencyOmissions':r['skipped'],'indexBytes':r['finalIndexStats']['primaries']['store']['size_in_bytes'],'measurementFields':70,'mappedFields':76,'recorder':r['recording'],'resourceNotes':['Node CPU deltas are whole-process cached counters and include sampler/background activity.','Heap and client RSS are observed sample maxima, not proven instantaneous peaks.','Parent resources processMemory describes container INIT wrapper, not Java RSS; its cgroup memory remains valid.','Projection retains only70 color fields, sourceOFF; no full-schema memory/storage equivalence.','Both banks query one shared projection. Bank latency difference does not quantify256-vs1024 physical index cost.','Synthetic million mixtures derive from523 real photos; warm repeated queries and controlled filters are not independent real corpus/user arrival behavior.','Successful-only percentiles: failed five-color profile has null p95, never interpret as zero latency.','Closed-loop C16 does not establish independent-arrival throughput capacity.'],'results':rows}
(D/'audit.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ['results','higherConcurrencyOmissions','resourceNotes']},indent=2))
if errors:raise SystemExit(1)
