import json,hashlib,math,collections,datetime
from pathlib import Path
D=Path(__file__).parent;ROOT=Path('/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark')
errors=[];checks=0

def ck(ok,msg):
 global checks
 checks+=1
 if not ok:errors.append(msg)
def sha(b):return hashlib.sha256(b).hexdigest()
def js(x):return json.dumps(x,ensure_ascii=False,separators=(',',':'))
def pct(a,p):return sorted(a)[max(0,math.ceil(len(a)*p)-1)] if a else None
def fail(x):return bool(x.get('error')) or x['elapsedMs']>=1000
rbytes=(D/'arrival.json').read_bytes();r=json.loads(rbytes);plan=json.loads((D/'plan.json').read_text());prioraudit=json.loads((D.parent/'projection/audit.json').read_text())
primaryBytes=(D/'primary-scale.json').read_bytes();primary=json.loads(primaryBytes)
ck(r.get('finishedAt') and not r.get('interruption'),'finished no interruption')
ck(prioraudit['passed'],'primary audit pass')
ck(sha(primaryBytes)==prioraudit['artifacts']['scale.json']['sha256']==r['primaryArtifactHash'],'primary exact bytes')
ck(r['primaryIdentityHash']==primary['identityHash'],'primary identity')
ck(r['sourceSnapshotHash']==plan['sourceSnapshotHash'],'plan source')
ck(sha(js(plan).encode())==r['planHash'],'plan identity hash')
src=json.loads((D/'source-snapshot.json').read_text());ck(sha(js(src).encode())==r['sourceSnapshotHash'],'source snapshot hash')
for f,t in src.items():ck((ROOT/f).read_text()==t,'current source frozen '+f)
ck(r['configuration']['rates']==[1,4,8,16] and r['configuration']['durationMs']==30000,'fixed rate protocol')
ck(r['configuration']['maxInFlight']==128 and r['configuration']['serviceTimeoutMs']==950 and r['configuration']['clientTimeoutMs']==1500,'timeout controls')
ck(len(r['profiles'])==8 and len(r['warmups'])==2,'8 profiles 2 warmups')
ck(len(r['selection']['selected'])==2 and len(r['selection']['omitted'])==2,'selection counts')
for side in ['indexBefore','indexAfter']:
 x=r[side];ck(x['count']==1000000 and x['uuid']==primary['indexSettings']['uuid'],'retained identity '+side)
 ck(x['sampleValuesHash']==primary['sampleAudits'][-1]['expectedHash'] and x['verifiedOrdinals']==[0,499999,999999],'retained sample values '+side)
ck({k:v for k,v in r['indexBefore'].items() if k!='at'}=={k:v for k,v in r['indexAfter'].items() if k!='at'},'index unchanged by recorded before/after audits')
for item in r['selection']['selected']:
 ck(item['queryId']=='picked-one-vibe' and item['selectivity']=='all','selected unrestricted vibe')
 p=[p for p in primary['profiles'] if p['id'] in item['primaryProfileIds']]
 ck(bool(p) and all(x['count']==1000000 and x['concurrency']==1 and x['viableAtTestedLoad'] and x['requestedDurationMs']>=10000 and len(x['trials'])>=32 and not any(fail(t) for t in x['trials']) for x in p),'primary qualifying profiles')
 w=[w for w in primary['warmups'] if w['id'] in item['primaryWarmupIds']]
 ck(bool(w) and all(not any(fail(t) for t in x['trials']) for x in w),'primary qualifying warmups')
for item in r['selection']['omitted']:
 ck(item['queryId']=='picked-five-portions','omission query')
 ck(any(p['count']==1000000 and p['caseId']==item['caseId'] and p['concurrency']==1 and not p['viableAtTestedLoad'] for p in primary['profiles']),'failed primary omission')
raw=[json.loads(x) for x in (D/'requests.jsonl').read_text().splitlines()]
rawby=collections.defaultdict(list)
for x in raw:rawby[(x['caseId'],x['phase'],x.get('rate'))].append(x)
ck(len(raw)==1742,'1740timed2warmup')
resources=[json.loads(x) for x in (D/'resources.jsonl').read_text().splitlines()];resby=collections.defaultdict(list)
for x in resources:resby[(x['caseId'],x['rate'])].append(x)
results=[];total=collections.Counter()
for p in r['profiles']:
 t=p['trials'];w=[w for w in r['warmups'] if w['caseId']==p['caseId']]
 ck(p['durationMs']==30000 and p['elapsedMs']>=30000 and len(t)==p['rate']*30,'30s rate count')
 ck([x['ordinal']for x in t]==list(range(len(t))),'complete unique ordinals')
 ck(sorted(rawby[(p['caseId'],'timed',p['rate'])],key=lambda x:x['ordinal'])==t,'raw exact trial parity')
 ck(w==rawby[(p['caseId'],'warmup',None)],'raw warmup parity')
 for x in t:
  ck(x['phase']=='timed' and x['caseId']==p['caseId'] and x['rate']==p['rate'] and x['parameters']==p['parameters'],'trial context')
  ck(math.isfinite(x['elapsedMs']) and math.isfinite(x['schedulerDelayMs']) and x['schedulerDelayMs']>=0,'finite scheduled timing')
  ck(x['elapsedMs']>=x['requestMs']+x['schedulerDelayMs']-1e-7 and x['elapsedMs']-x['requestMs']-x['schedulerDelayMs']<1,'scheduled latency includes dispatch delay')
  ck(x.get('hitCount')==20 and math.isfinite(x['topHit']['score']),'complete service result')
 v=[x['elapsedMs']for x in t]
 exp={'requests':len(t),'errors':sum(bool(x.get('error'))for x in t),'clientRejected':sum(bool(x.get('clientRejected'))for x in t),'overOneSecond':sum(x['elapsedMs']>=1000 for x in t),'p50Ms':pct(v,.5),'p95Ms':pct(v,.95),'p99Ms':pct(v,.99),'maxMs':max(v),'maximumSchedulerDelayMs':max(x['schedulerDelayMs']for x in t),'strictTimedFailures':sum(fail(x)for x in t),'strictWarmupFailures':sum(fail(x)for x in w),'strictFailures':sum(fail(x)for x in t+w),'warmupErrors':sum(bool(x.get('error'))for x in w),'warmupOverOneSecond':sum(x['elapsedMs']>=1000 for x in w),'viableAtTestedLoad':bool(t)and not any(fail(x)for x in t+w)}
 ck(all(p[k]==v for k,v in exp.items()),'summary recompute')
 ck(p['offeredRatePerSecond']==p['rate'] and math.isclose(p['throughputPerSecond'],len(t)/(p['elapsedMs']/1000),rel_tol=1e-14),'achieved throughput full observation window')
 ck(math.isclose(p['successfulThroughputPerSecond'],sum(not x.get('error')for x in t)/(p['elapsedMs']/1000),rel_tol=1e-14),'successful throughput')
 ck(p['peakInFlight']<=128,'bounded inflight')
 sr=[{k:v for k,v in x.items() if k not in ['caseId','rate']}for x in resby[(p['caseId'],p['rate'])]]
 ck(sr==p['samples'][1:-1] and p['samples'][0]==p['before'] and p['samples'][-1]==p['after'],'raw resource sample parity')
 ck(max(sum(n.get('jvm',{}).get('mem',{}).get('heap_used_in_bytes',0) for n in x.get('nodes',{}).values())for x in p['samples'])==p['peakObservedHeapBytes'],'observed heap maximum')
 ck(max(x.get('clientMemory',{}).get('rss',0)for x in p['samples'])==p['peakObservedClientRssBytes'],'observed driver maximum')
 total.update({'requests':len(t),'errors':exp['errors'],'slow':exp['overOneSecond'],'failureUnion':exp['strictTimedFailures'],'clientRejected':exp['clientRejected']})
 results.append({k:p[k]for k in ['caseId','rate','requests','p50Ms','p95Ms','p99Ms','maxMs','maximumSchedulerDelayMs','throughputPerSecond','peakInFlight','viableAtTestedLoad']})
for case in r['selection']['selected']:
 ps=[p for p in r['profiles']if p['caseId']==case['id']]
 ck([p['rate']for p in ps]==[1,4,8,16],'all increasing rates')
 for a,b in zip(ps,ps[1:]):ck(a['viableAtTestedLoad'],'escalate only passing rate')
for s in r['settling']:
 ck(s['settled'] and len(s['samples'])>=2,'settling achieved')
 ck(all(all(x[k]==0 for k in ['active','queued','queryCurrent','fetchCurrent','merges'])for x in s['samples'][-2:]),'two quiet samples')
out={'auditedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'auditor':'independent favorite_perf_audit filesystem-only','passed':not errors,'checks':checks,'errors':errors,'artifacts':{f:sha((D/f).read_bytes())for f in ['arrival.json','plan.json','source-snapshot.json','requests.jsonl','resources.jsonl']},'primaryArtifactSha256':sha(primaryBytes),'sourceSnapshotHash':r['sourceSnapshotHash'],'auditScriptSha256':sha(Path(__file__).read_bytes()),'profiles':len(r['profiles']),'warmups':len(r['warmups']),'rawRequests':len(raw),'rawResources':len(resources),'timed':dict(total),'warmupFailureUnion':sum(fail(x)for x in r['warmups']),'indexAuditUnchanged':True,'results':results,'limitations':['Only two unrestricted single-color cases qualified; five-color cases were omitted because primary C1 failed. One/two-color proportion cases are outside this representative arrival subset.','Both banks share a projected70-color-field sourceOFF million-mixture index; this is not full-schema capacity.','All-request scheduled-to-completion percentiles include scheduler delay; offered rates are fixed, achieved throughput includes full30-second window and drain.','Eight30-second profiles support the measured host/workload conditions, not universal production concurrency guarantees.','Index stability was checked from captured UUID/mapping/count and3 sample-value audits before/after; this independent audit issues no new service queries.']}
(D/'audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
if errors:raise SystemExit(1)
