"""Filesystem-only independent audit; execute only after maintained timing ends."""
import json,hashlib,math,collections,datetime,sys
from pathlib import Path
D=Path(sys.argv[1]).resolve();ROOT=Path('/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark')
errors=[];checks=0

def ck(ok,msg):
 global checks
 checks+=1
 if not ok:errors.append(msg)
def sha(b):return hashlib.sha256(b).hexdigest()
def js(x):return json.dumps(x,ensure_ascii=False,separators=(',',':'))
def fail(x):return bool(x.get('error'))or x['elapsedMs']>=1000
def pct(a,p):return sorted(a)[max(0,math.ceil(len(a)*p)-1)]if a else None
rbytes=(D/'maintained.json').read_bytes();r=json.loads(rbytes);plan=json.loads((D/'plan.json').read_text())
ck(r.get('finishedAt')and not r.get('interruption'),'finished confirmation')
ck(r['experiment']=='strict-hue-favorite-maintained'and r['snapshotId']=='strict-hue-favorite-001','confirmation identity')
ck(r['scope']=='projection'and r['count']==1000000,'million projection')
ck(r['configuration']['requests']==32 and r['configuration']['durationMs']==10000 and r['configuration']['concurrencies']==[1,4,16],'fixed load')
ck(r['configuration']['serviceTimeoutMs']==950 and r['configuration']['clientTimeoutMs']==1500 and r['configuration']['strictBoundaryMs']==1000,'strict timeouts')
ck(sha(js(plan).encode())==r['planHash'],'plan checksum')
priorbytes=(D/'primary-scale.json').read_bytes();prioraudit=json.loads((D.parent/'projection/audit.json').read_text())
ck(prioraudit['passed']and sha(priorbytes)==prioraudit['artifacts']['scale.json']['sha256']==r['primaryArtifactHash'],'exact independently audited parent copy')
ck(sha(Path(r['primaryArtifact']).read_bytes())==r['primaryArtifactHash'],'original parent unchanged')
primary=json.loads(priorbytes)
ck(r['primaryIdentityHash']==primary['identityHash'],'parent identity')
src=json.loads((D/'source-snapshot.json').read_text());ck(sha(js(src).encode())==r['sourceSnapshotHash'],'source snapshot hash')
for f,text in src.items():ck((ROOT/f).read_text()==text,'frozen source '+f)
ck(len(r['workload'])==8 and all(x['selectivity']=='all'and not x.get('filter')for x in r['workload']),'8unfiltered cases')
parentplans={x['caseId']:x for x in primary['queryPlans']}
for p in r['queryPlans']:ck(p==parentplans[p['caseId']],'exact original query plan '+p['caseId'])
for label in ['indexBefore','indexAfter']:
 x=r[label]
 ck(x['count']==1000000 and x['uuid']==primary['indexSettings']['uuid'],'retained index '+label)
 ck(x['verifiedOrdinals']==[0,499999,999999]and x['sampleValuesHash']==primary['sampleAudits'][-1]['expectedHash'],'retained source values '+label)
ck({k:v for k,v in r['indexBefore'].items()if k!='at'}=={k:v for k,v in r['indexAfter'].items()if k!='at'},'retained index identity unchanged')
if r['maintenance'].get('path'):
 mbytes=Path(r['maintenance']['path']).read_bytes();ck(sha(mbytes)==r['maintenance']['sha256'],'maintenance receipt exact bytes')
 ck(json.loads(mbytes)==r['maintenance']['record'],'maintenance receipt embedded parity')
 m=r['maintenance']['record'];ck(m.get('finishedAt')and m.get('preconditionsVerified')and not m.get('interruption'),'maintenance completed')
 matching=[x for x in m['indices']if x['index']==r['index']];ck(len(matching)==1,'maintenance bound to projected index')
 if matching:
  x=matching[0];ck(x['uuid']==r['indexBefore']['uuid']and x['identityHash']==r['primaryIdentityHash'],'maintenance UUID/source identity')
  ck(x['status']=='complete'and x['after']['count']['body']['count']==1000000,'maintenance projected phase complete')
profiles={p['id']:p for p in r['profiles']};warmups={w['id']:w for w in r['warmups']};cases={x['id']:x for x in r['workload']}
ck(len(warmups)==8 and 8<=len(profiles)<=24,'8warmups bounded profiles')
seen={pid:bytearray(len(p['trials']))for pid,p in profiles.items()};seenwarm=collections.Counter();rawcounts=collections.Counter();rawhash=hashlib.sha256();rawbytes=0
compact=['ordinal','elapsedMs','serviceTookMs','hitCount','overOneSecond','error','parityMismatch'];context=['count','caseId','variant','queryId','selectivity','method','parameters','concurrency']
referenceCounts=collections.Counter();rawWarmups={}
with(D/'requests.jsonl').open('rb')as fh:
 for n,line in enumerate(fh,1):
  rawhash.update(line);rawbytes+=len(line);x=json.loads(line);rawcounts[x['phase']]+=1
  if x['phase']=='timed':
   p=profiles.get(x.get('profileId'));ck(p is not None,'known profile')
   if p is None:continue
   o=x['ordinal'];ck(isinstance(o,int)and 0<=o<len(p['trials']),'ordinal bounds')
   if not isinstance(o,int)or not 0<=o<len(p['trials']):continue
   ck(not seen[p['id']][o],'unique ordinal');seen[p['id']][o]=1
   ck(all(x.get(k)==p.get(k)for k in context),'raw profile context')
   ck({k:x[k]for k in compact if k in x}==p['trials'][o],'raw compact parity')
   ck(x['requestId']==p['id']+':timed:'+str(o),'requestID')
  elif x['phase']=='warmup':
   w=warmups.get(x.get('warmupId'));ck(w is not None,'known warmup')
   if w is None:continue
   seenwarm[w['id']]+=1;rawWarmups[x['caseId']]=x
   ck({k:v for k,v in x.items()if k!='hits'}==w['trials'][x['ordinal']],'raw warmup parity')
  else:ck(False,'unexpectedphase')
  ck(math.isfinite(x['elapsedMs'])and x['elapsedMs']>=0,'finite timing')
  ck(x['overOneSecond']==(x['elapsedMs']>=1000),'strict threshold')
  ck(not x.get('parityMismatch'),'no semantic parity error')
  ck(x['hitCount']==(0 if x.get('error')else 20),'global top20')
  if not x.get('error'):
   ref=cases[x['caseId']]['reference']
   ck(x['scoreParity']==('match'if ref['available']else'unavailable'),'score reference status')
   if ref['available']:ck(x['hitsHash']==ref['hitsHash'],'original score hash exact')
   referenceCounts['matchedRequests'if ref['available']else'unavailableRequests']+=1
for k,b in seen.items():ck(all(b),'complete profile raw '+k)
for k,w in warmups.items():ck(seenwarm[k]==len(w['trials']),'complete warmup raw '+k)
results=[];totals=collections.Counter()
for p in profiles.values():
 t=p['trials'];w=[x for wid in p['warmupIds']for x in warmups[wid]['trials']];good=[x['elapsedMs']for x in t if not x.get('error')]
 ck([x['ordinal']for x in t]==list(range(len(t))),'profile ordinals')
 expected={'requests':len(t),'p50Ms':pct(good,.5),'p95Ms':pct(good,.95),'p99Ms':pct(good,.99),'maxMs':max(x['elapsedMs']for x in t),'errors':sum(bool(x.get('error'))for x in t),'overOneSecond':sum(x['elapsedMs']>=1000 for x in t),'warmupErrors':sum(bool(x.get('error'))for x in w),'warmupOverOneSecond':sum(x['elapsedMs']>=1000 for x in w),'strictTimedFailures':sum(fail(x)for x in t),'strictWarmupFailures':sum(fail(x)for x in w),'timedRequestsViable':not any(fail(x)for x in t),'viableAtTestedLoad':bool(w)and not any(fail(x)for x in t+w)}
 ck(all(p[k]==v for k,v in expected.items()),'statistics '+p['id'])
 ck(len(t)>=32 and p['elapsedMs']>=10000 and p['minimumRequests']==32 and p['requestedDurationMs']==10000,'minimum load')
 ck(math.isclose(p['throughputPerSecond'],len(t)/(p['elapsedMs']/1000),rel_tol=1e-14),'throughput')
 ck(p['parameters']==cases[p['caseId']]['parameters']and p['method']==cases[p['caseId']]['method'],'saved tuning')
 totals.update({'timed':len(t),'errors':expected['errors'],'slow':expected['overOneSecond'],'failureUnion':expected['strictTimedFailures'],'passingProfiles':int(expected['viableAtTestedLoad'])})
 results.append({k:p[k]for k in ['caseId','queryId','concurrency','requests','p50Ms','p95Ms','p99Ms','maxMs','errors','overOneSecond','strictTimedFailures','warmupErrors','warmupOverOneSecond','viableAtTestedLoad','throughputPerSecond','cpuMs','clientCpuMs']})
for case in cases.values():
 ps=sorted([p for p in profiles.values()if p['caseId']==case['id']],key=lambda x:x['concurrency'])
 ck(bool(ps)and ps[0]['concurrency']==1,'eachcase startsC1')
 for i,p in enumerate(ps):
  ck(p['concurrency']==[1,4,16][i],'no missing intermediate load')
  if i:ck(ps[i-1]['viableAtTestedLoad'],'escalation only afterpass')
 missing=[c for c in[1,4,16]if c not in[p['concurrency']for p in ps]]
 ck(missing==[c for skip in r['skipped']if skip['caseId']==case['id']for c in skip['concurrencies']],'exactskips')
 if missing:ck(not ps[-1]['viableAtTestedLoad'],'skip onlyafterfailure')
 ref=case['reference'];parentws=[w for w in primary['warmups']if w['count']==1000000 and w['caseId']==case['id']]
 valid=[t for w in parentws for t in w['trials']if not t.get('error')]
 ck(ref['available']==bool(valid),'honest reference availability')
 if valid:ck(all(t['hitsHash']==ref['hitsHash']for t in valid),'original reference hash')
resources=[];reshash=hashlib.sha256();resbytes=0;resby=collections.defaultdict(list)
with(D/'resources.jsonl').open('rb')as fh:
 for line in fh:
  reshash.update(line);resbytes+=len(line);x=json.loads(line);resources.append(x);resby[x['profileId']].append(x)
for p in profiles.values():
 samples=[p['before']]+resby[p['id']]+[p['after']]
 ck(len(samples)==p['resourceSampleCount'],'resource sample count')
 ck(sum(bool(x.get('error'))for x in samples)==p['resourceErrors'],'resourceerrors')
 ck(max(sum(n.get('jvm',{}).get('mem',{}).get('heap_used_in_bytes',0)for n in x.get('nodes',{}).values())for x in samples)==p['peakObservedHeapBytes'],'sampledheap')
 ck(max(x.get('clientMemory',{}).get('rss',0)for x in samples)==p['peakObservedClientRssBytes'],'sampledclientRSS')
 for layout in[p['layoutBefore'],p['layoutAfter']]:ck(layout['stats']['primaries']['docs']['count']==1000000,'profilelayout count')
for s in r['settling']:
 ck(s['settled']and len(s['samples'])>=2,'settled')
 ck(all(all(x[k]==0 for k in['active','queued','queryCurrent','fetchCurrent','merges'])for x in s['samples'][-2:]),'quietsearch+merge')
ck(sum(rawcounts.values())+len(resources)==r['recording']['totalRows'],'recorder rowtotal')
ck(rawbytes+resbytes==r['recording']['totalBytes'],'recorderbytetotal')
ck(rawcounts['timed']==totals['timed']and rawcounts['warmup']==8,'raw totals')
out={'auditedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'auditor':'independent favorite_perf_audit filesystem-only','passed':not errors,'checks':checks,'errors':errors,'profiles':len(profiles),'warmups':len(warmups),'strictTotals':dict(totals),'warmupFailureUnion':sum(fail(x)for w in warmups.values()for x in w['trials']),'scoreReferences':dict(referenceCounts),'skipped':r['skipped'],'sourceSnapshotHash':r['sourceSnapshotHash'],'primaryArtifactSha256':r['primaryArtifactHash'],'maintenanceReceiptSha256':r['maintenance'].get('sha256'),'artifacts':{'maintained.json':{'sha256':sha(rbytes),'bytes':len(rbytes)},'requests.jsonl':{'sha256':rawhash.hexdigest(),'bytes':rawbytes,'rows':sum(rawcounts.values()),'phases':dict(rawcounts)},'resources.jsonl':{'sha256':reshash.hexdigest(),'bytes':resbytes,'rows':len(resources)}},'layoutBefore':{'storeBytes':r['layoutBefore']['stats']['primaries']['store']['size_in_bytes'],'segments':r['layoutBefore']['stats']['primaries']['segments']['count']},'layoutAfter':{'storeBytes':r['layoutAfter']['stats']['primaries']['store']['size_in_bytes'],'segments':r['layoutAfter']['stats']['primaries']['segments']['count']},'auditScriptSha256':sha(Path(__file__).read_bytes()),'results':results,'limitations':['Separate post-maintenance confirmation; original campaign and its failures remain immutable.','Million projection70numericfields/sourceOFF, not full million-wallpaper schema.','Successful-only percentile may conceal a highfailure profile; failures andstrictunion are reported alongside.','Original five-color warmups timedout, so no original successful top20 reference exists for thosecases.','Global scorehash parity checked for every available originalreference; maintenance changes physical layout, notquerysettings.','Closedloop and warm fixed queries do not establish broad sustained production arrivalcapacity.']}
(D/'audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:v for k,v in out.items()if k not in ['results','limitations']},indent=2))
if errors:raise SystemExit(1)
