"""Filesystem-only audit. Run after timing finishes; never sends service requests."""
import json,hashlib,math,collections,datetime,sys
from pathlib import Path
D=Path(sys.argv[1]).resolve(); ROOT=Path('/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark')
errors=[];checks=0

def ck(ok,msg):
 global checks
 checks+=1
 if not ok:errors.append(msg)
def sha(b):return hashlib.sha256(b).hexdigest()
def js(x):return json.dumps(x,ensure_ascii=False,separators=(',',':'))
def fail(x):return bool(x.get('error')) or x['elapsedMs']>=1000
def pct(a,p):return sorted(a)[max(0,math.ceil(len(a)*p)-1)] if a else None
rbytes=(D/'scale.json').read_bytes();r=json.loads(rbytes);bank=r['configuration']['bucketCount'];nfields={256:2606,1024:10286}[bank]
ck(not r.get('finishedAt'),'parent correctly remains incomplete')
invocations=r.get('invocations',[]);lastInvocation=invocations[-1]['id']
ck(len(invocations)==2 and len(r.get('interruptions',[]))==2,'two preserved attempts/interruptions')
expectedErrors=['Error: Search queue or merges did not settle; refusing to contaminate another block.','Error: Favorite scale mapping differs from frozen inputs.']
for idx,interruption in enumerate(r['interruptions']):
 ck(interruption['error'].split('\n')[0]==expectedErrors[idx],'expected guard interruption')
 ck(interruption['invocationId']==invocations[idx]['id']and interruption['nextIndex']==100000,'interruption lineage and indexedcount')
 ck(not any(x['invocationId']==interruption['invocationId']and x['count']==100000 for x in r['profiles']+r['warmups']),'no100k query before either guard')
for invocation in invocations:
 cfg=invocation['configuration']
 ck(all(cfg.get(k)==r['configuration'].get(k)for k in ['scope','bucketCount','counts','concurrencies','requests','durationSeconds','batchSize','seed','limit','index']),'same frozen protocol on retry')
 ck(invocation['sourceSnapshotHash']==r['sourceSnapshotHash'],'same source on retry')
ck(r['scope']=='full' and r['fullSchema'] and r['projection']['fullIndexCapacityMeasured'],'full schema scope')
ck(r['configuration']['counts']==[10000,100000] and r['configuration']['concurrencies']==[1],'pilot stages/C1')
ck(r['configuration']['requests']==32 and r['configuration']['durationSeconds']==10,'request/time minimum')
ck(r['source']['sourceCount']==523 and r['source']['verifiedOriginalCount']==545 and r['source']['excludedFixtureCount']==22,'real-only sources')
ck(r['configuration']['seed']==99539473,'coherent corpus seed')
ck(len(r['identity']['fields'])==nfields==r['projection']['fieldCount'],'all numeric fields')
ck(int(r['indexSettings']['mapping']['total_fields']['limit'])==nfields+6+20,'full mapped-field setting')
ck(r['indexing'][-1]['count']==100000 and r['indexing'][-1]['from']==10000 and r['indexing'][-1]['indexed']==90000,'100k indexing finished before guard')
manifest_bytes=(ROOT/'exploration/snapshots/strict-hue-favorite-001.json').read_bytes();manifest=json.loads(manifest_bytes)
ck(sha(manifest_bytes)==r['source']['snapshotManifestHash'],'favorite manifest')
ck(sha(Path(manifest['sourceArchive']['path']).read_bytes())==r['source']['sourceArchiveHash'],'favorite archive')
ck(sha(Path(manifest['sourceArchive']['inventory']['path']).read_bytes())==r['source']['sourceInventoryHash'],'favorite inventory')
src=json.loads((D/'source-snapshot.json').read_text());ck(sha(js(src).encode())==r['sourceSnapshotHash'],'source snapshot hash')
for f,text in src.items():
 ck((ROOT/f).read_text()==text,'frozen current source '+f)
 ck(sha(text.encode())==r['sourceHashes'][f]==r['identity']['sourceHashes'][f],'source file hash '+f)
for f,h in r['source']['sourceHashes'].items():ck(sha((ROOT/'exploration'/f).read_bytes())==h==manifest['measurements']['sourceHashes'][f],'extraction source '+f)
for receipt in r['source']['receipts']:
 saved=next(x for x in manifest['measurements']['indices']if x['bucketCount']==receipt['bucketCount'])
 ck(sha(Path(saved['receipt']['path']).read_bytes())==receipt['receiptSha256'],'receipt checksum')
 ck(receipt['valuesHash']==saved['valuesHash'] and receipt['anchorsHash']==saved['anchorsHash'],'strict-hue values/anchors')
ck(len(r['sampleAudits'])==1 and all(x['verified'] and x['fieldsPerDocument']==nfields for x in r['sampleAudits']),'full numeric sample audits')
ck([x['count']for x in r['sampleAudits']]==[10000],'sample audit counts')
ck(len(r['queryPlans'])==12 and len(r['workload'])==12,'12 independent queries')
for p in r['queryPlans']:
 body=p['body'];dump=js(body)
 ck(body['size']==20 and body['_source']==False and body['track_total_hits']==False and body['timeout']=='950ms','query controls')
 ck(body['sort']==[{'_score':'desc'},{'id':'asc'}] and 'terminate_after' not in body and 'rescore' not in body and 'script_score' not in dump,'global native score')
 ck(set(p['requiredFields'])<=set(r['identity']['fields']),'query complete fields')
profiles={p['id']:p for p in r['profiles']};warmups={w['id']:w for w in r['warmups']}
ck(len(profiles)==12 and len(warmups)==12,'12 completed10k profiles/warmups')
ck(collections.Counter(p['count']for p in profiles.values())=={10000:12},'only10k profiles')
for skip in r['skipped']:
 ck(skip.get('count')==10000 and skip.get('invocationId')==lastInvocation and 'Index already larger' in skip.get('reason','') and not skip.get('caseId'),'resume records only already-measured smaller stage skip')
 ck(sum(p['count']==10000 for p in r['profiles'])==12,'resumed skip retains all12original10k profiles')
seen={pid:bytearray(len(p['trials']))for pid,p in profiles.items()};seenwarm=collections.Counter();rawcounts=collections.Counter();rawhash=hashlib.sha256();rawbytes=0
rawRowsByInvocation=collections.Counter();rawBytesByInvocation=collections.Counter()
compact=['ordinal','elapsedMs','serviceTookMs','hitCount','overOneSecond','error'];context=['invocationId','count','caseId','variant','queryId','selectivity','method','parameters','concurrency']
rawWarmups={}
with (D/'requests.jsonl').open('rb')as fh:
 for n,line in enumerate(fh,1):
  rawhash.update(line);rawbytes+=len(line);x=json.loads(line);rawcounts[x['phase']]+=1;rawRowsByInvocation[x['invocationId']]+=1;rawBytesByInvocation[x['invocationId']]+=len(line)
  if x['phase']=='timed':
   p=profiles.get(x.get('profileId'));ck(p is not None,'known raw profile')
   if p is None:continue
   o=x['ordinal'];ck(isinstance(o,int)and 0<=o<len(p['trials']),'ordinal bounds')
   if not isinstance(o,int)or not 0<=o<len(p['trials']):continue
   ck(not seen[p['id']][o],'no duplicate rawordinal');seen[p['id']][o]=1
   ck(all(x.get(k)==p.get(k)for k in context),'raw context parity')
   ck({k:x[k]for k in compact if k in x}==p['trials'][o],'raw compact parity')
   ck(x['requestId']==p['id']+':timed:'+str(o),'raw unique requestID')
  elif x['phase']=='warmup':
   w=warmups.get(x.get('warmupId'));ck(w is not None,'known warmup')
   if w is None:continue
   seenwarm[w['id']]+=1;rawWarmups[(x['count'],x['caseId'])]=x
   ck({k:v for k,v in x.items()if k!='hits'}==w['trials'][x['ordinal']],'warmup raw parity')
  else:ck(False,'unknown phase')
  ck(math.isfinite(x['elapsedMs'])and x['elapsedMs']>=0,'finite latency')
  ck(x['overOneSecond']==(x['elapsedMs']>=1000),'strict raw threshold')
  ck(x['hitCount']==(0 if x.get('error')else 20),'service top20')
  if n%200000==0:print('audited raw',n,flush=True)
for k,bits in seen.items():ck(all(bits),'complete raw profile '+k)
for k,w in warmups.items():ck(seenwarm[k]==len(w['trials']),'complete warmup '+k)
rows=[];totals=collections.Counter()
for p in profiles.values():
 t=p['trials'];w=[x for wid in p['warmupIds']for x in warmups[wid]['trials']];good=[x['elapsedMs']for x in t if not x.get('error')]
 ck([x['ordinal']for x in t]==list(range(len(t))),'contiguous profile ordinals')
 exp={'requests':len(t),'p50Ms':pct(good,.5),'p95Ms':pct(good,.95),'p99Ms':pct(good,.99),'maxMs':max(x['elapsedMs']for x in t),'errors':sum(bool(x.get('error'))for x in t),'overOneSecond':sum(x['elapsedMs']>=1000 for x in t),'warmupErrors':sum(bool(x.get('error'))for x in w),'warmupOverOneSecond':sum(x['elapsedMs']>=1000 for x in w),'strictTimedFailures':sum(fail(x)for x in t),'strictWarmupFailures':sum(fail(x)for x in w),'timedRequestsViable':not any(fail(x)for x in t),'viableAtTestedLoad':bool(w)and not any(fail(x)for x in t+w)}
 ck(all(p[k]==v for k,v in exp.items()),'profile summary recompute '+p['id'])
 ck(len(t)>=32 and p['elapsedMs']>=10000 and p['minimumRequests']==32 and p['requestedDurationMs']==10000 and p['concurrency']==1,'minimum duration/count/C1')
 ck(math.isclose(p['throughputPerSecond'],len(t)/(p['elapsedMs']/1000),rel_tol=1e-14),'throughput')
 ck(p['method']=='cutoff-shade-hue-all-levels' and p['parameters']['qualityCurve']=='linear' and p['parameters']['qualityInfluence']==.5 and p['parameters']['cutoffBlendExponent']==1 and p['parameters']['bucketCount']==bank,'favorite tuning')
 totals.update({'timed':len(t),'errors':exp['errors'],'slow':exp['overOneSecond'],'failureUnion':exp['strictTimedFailures'],'passingProfiles':int(exp['viableAtTestedLoad'])})
 rows.append({k:p[k]for k in ['count','caseId','queryId','selectivity','requests','p50Ms','p95Ms','p99Ms','maxMs','errors','overOneSecond','strictTimedFailures','warmupErrors','warmupOverOneSecond','viableAtTestedLoad','throughputPerSecond','cpuMs','clientCpuMs','peakObservedHeapBytes','peakObservedClientRssBytes']})
resources=[];reshash=hashlib.sha256();resbytes=0;resby=collections.defaultdict(list)
with(D/'resources.jsonl').open('rb')as fh:
 for line in fh:
  reshash.update(line);resbytes+=len(line);x=json.loads(line);resources.append(x);resby[x['profileId']].append(x);rawRowsByInvocation[x['invocationId']]+=1;rawBytesByInvocation[x['invocationId']]+=len(line)
for p in profiles.values():
 samples=[p['before']]+resby[p['id']]+[p['after']]
 ck(len(samples)==p['resourceSampleCount'],'resource count')
 ck(sum(bool(x.get('error'))for x in samples)==p['resourceErrors'],'resource errors')
 ck(max(sum(n.get('jvm',{}).get('mem',{}).get('heap_used_in_bytes',0)for n in x.get('nodes',{}).values())for x in samples)==p['peakObservedHeapBytes'],'sampled heap')
 ck(max(x.get('clientMemory',{}).get('rss',0)for x in samples)==p['peakObservedClientRssBytes'],'sampled clientRSS')
 before,after=p['before'],p['after'];cpu=lambda x:sum(n.get('process',{}).get('cpu',{}).get('total_in_millis',0)for n in x['nodes'].values())
 ck(cpu(after)-cpu(before)==p['cpuMs'],'nodeCPUdelta')
 ck(math.isclose((after['clientCpu']['user']+after['clientCpu']['system']-before['clientCpu']['user']-before['clientCpu']['system'])/1000,p['clientCpuMs'],rel_tol=1e-14),'clientCPUdelta')
ck(rawRowsByInvocation[lastInvocation]==r['recording']['totalRows'],'final invocation recorder totalrows')
ck(rawBytesByInvocation[lastInvocation]==r['recording']['totalBytes'],'final invocation recorder totalbytes')
ck(rawcounts['timed']==totals['timed']and rawcounts['warmup']==12,'raw totals')
for s in r['settling']:
 if not s['settled']:
  ck(any(x['invocationId']==s.get('invocationId')for x in r.get('interruptions',[])),'failed guard tied to recorded interruption')
  ck(s.get('phase')=='after-indexing' and s.get('count')==100000 and s['samples'][-1]['merges']>0,'historical merge guard evidence')
  ck(all(all(x[k]==0 for k in ['active','queued','queryCurrent','fetchCurrent'])for x in s['samples']),'historical guard has no active search work')
  continue
 ck(len(s['samples'])>=2,'settled samples')
 ck(all(all(x[k]==0 for k in ['active','queued','queryCurrent','fetchCurrent','merges'])for x in s['samples'][-2:]),'quiet search+merges')
ck(sum(not s['settled']for s in r['settling'])==1,'one historical mergeguard')
scoreparity=[]
out={'auditedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'auditor':'independent favorite_perf_audit filesystem-only','passed':not errors,'checks':checks,'errors':errors,'bank':bank,'profiles':len(profiles),'profilesByCount':dict(collections.Counter(p['count']for p in profiles.values())),'strictTotals':dict(totals),'warmupFailureUnion':sum(fail(x)for w in warmups.values()for x in w['trials']),'measurementFields':nfields,'mappedFields':nfields+6,'sourceEnabled':True,'sourceVerification':'Frozen full-scope creator uses hueMapping({source:true}); the captured10k sample audit verifies exact full _source before timing. Independent audit uses captured evidence, not new service requests.','indexBytes':None,'lastMeasuredStageIndexBytes':r['indexStats'][-1]['stats']['primaries']['store']['size_in_bytes'],'status':'Parent incomplete; only10k timing audited.100k data indexed but all100k measurements belong to separatecompletion.','recording':r['recording'],'recordingScope':'Final invocation only; combined append-only raw files reconciled separately.','rawRowsByInvocation':dict(rawRowsByInvocation),'rawBytesByInvocation':dict(rawBytesByInvocation),'invocations':invocations,'historicalInterruptions':r.get('interruptions',[]),'skippedStages':r['skipped'],'sourceSnapshotHash':r['sourceSnapshotHash'],'artifacts':{'scale.json':{'sha256':sha(rbytes),'bytes':len(rbytes)},'requests.jsonl':{'sha256':rawhash.hexdigest(),'bytes':rawbytes,'rows':sum(rawcounts.values()),'phases':dict(rawcounts)},'resources.jsonl':{'sha256':reshash.hexdigest(),'bytes':resbytes,'rows':len(resources)}},'scoreParityWithProjection':scoreparity,'auditScriptSha256':sha(Path(__file__).read_bytes()),'results':rows,'limitations':['Full schema and source retained; this parent has only10000-document concurrency1 query measurements.100k is indexed but not timed here.','Mixtures derive from523 real images; repeated structure and warm fixed anchors may favor compression/caching.','Parent resource processMemory is container INIT wrapper, not JavaRSS; cgroup memory remains valid.','CPU counters include cached/background work; heap/RSS are sampled observations.','No100k queries exist in this parent, so its score-parity comparison belongs to the separatecompletion audit.','No1M full-schema or100M capacity claim.']}
(D/'parent-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:v for k,v in out.items()if k not in ['results','scoreParityWithProjection','limitations']},indent=2))
if errors:raise SystemExit(1)
