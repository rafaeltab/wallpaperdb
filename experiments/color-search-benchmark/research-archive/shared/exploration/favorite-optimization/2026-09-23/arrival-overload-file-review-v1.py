#!/usr/bin/env python3
"""Saved-file-only request attribution; no service calls or helper imports."""
import collections, datetime, hashlib, json, math, pathlib
R=pathlib.Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23')
OUT=R/'arrival-overload-file-review-v1'
OUT.mkdir(exist_ok=False)
def quant(v):
 v=sorted(x for x in v if isinstance(x,(int,float)) and math.isfinite(x))
 return {'count':len(v),'p50':v[math.ceil(.5*len(v))-1] if v else None,'p95':v[math.ceil(.95*len(v))-1] if v else None,'max':v[-1] if v else None}
def fail(d):return bool(d.get('error') or d.get('clientRejected') or d.get('elapsedMs',0)>=1000)
def ts(v):return datetime.datetime.fromisoformat(v.replace('Z','+00:00')).timestamp() if v else None
def small(d):
 z={k:d[k] for k in ['ordinal','queryId','startedAt','completedAt','error','errorDetails','clientRejected','schedulerDelayMs','requestMs','elapsedMs','serviceTookMs'] if k in d}
 e=d.get('executionEvidence',{})
 if e:z['stages']=e.get('stages');z['transport']=e.get('transport')
 return z
reports=[]
for name in ['full-million-pooled-arrival-fixed-v1','full-million-pooled-arrival-wide-v1','full-million-pooled-wide-two-methods-stress-v1']:
 p=R/name; a=json.loads((p/'arrival.json').read_text()); plan=json.loads((p/'plan.json').read_text()); shapes={x['id']:len(x['query']['targets']) for x in plan['queries']}
 wanted={(x['candidateId'],x['rate']):x for x in a['profiles'] if (name.endswith('fixed-v1') and x['rate'] in (64,128)) or not name.endswith('fixed-v1')}
 rows=collections.defaultdict(list); raw_hash=hashlib.sha256()
 with (p/'requests.jsonl').open('rb') as f:
  for l in f:
   raw_hash.update(l);d=json.loads(l)
   if d.get('phase')=='timed' and (d['candidateId'],d['rate']) in wanted:rows[(d['candidateId'],d['rate'])].append(d)
 for key,profile in wanted.items():
  ds=rows[key]; failed=[d for d in ds if fail(d)]; success=[d for d in ds if not d.get('error') and not d.get('clientRejected')]
  strict=len(failed); assert len(ds)==profile['requests'];assert strict==sum(fail(d) for d in profile['trials'])
  def groupmetric(seq):return {k:quant([d.get(k) for d in seq]) for k in ['elapsedMs','schedulerDelayMs','requestMs','serviceTookMs']}
  codes=collections.Counter();phases=collections.Counter();endbins=collections.Counter();startbins=collections.Counter()
  for d in failed:
   if d.get('error'):codes[d['error']]+=1
   ee=d.get('executionEvidence',{});ss=ee.get('stages',[])
   if ss:phases[' > '.join(s['phase'] for s in ss)]+=1
   if d.get('completedAt'):endbins[d['completedAt'][:19]]+=1
   if d.get('startedAt'):startbins[d['startedAt'][:19]]+=1
  r={'campaign':name,'candidateId':key[0],'rate':key[1],'rawSha256':raw_hash.hexdigest(),'requests':len(ds),'strictFailures':strict,'errors':sum(bool(d.get('error')) for d in ds),'clientRejected':sum(bool(d.get('clientRejected')) for d in ds),'overOneSecond':sum(d.get('elapsedMs',0)>=1000 for d in ds),'all':groupmetric(ds),'successful':groupmetric(success),'failed':groupmetric(failed),'errorMessages':dict(codes),'errorPhasePaths':dict(phases),'failureCompletionSecondsMostCommon':endbins.most_common(12),'failureStartSecondsMostCommon':startbins.most_common(12),'failedFirst':small(failed[0]) if failed else None,'failedLast':small(failed[-1]) if failed else None,'slowest':[small(d) for d in sorted(ds,key=lambda d:d['elapsedMs'],reverse=True)[:5]],'shapes':{},'delayGroups':dict(collections.Counter(('rejected' if d.get('clientRejected') else 'both>=1s' if d.get('schedulerDelayMs',0)>=1000 and d.get('requestMs',0)>=1000 else 'scheduler>=1s' if d.get('schedulerDelayMs',0)>=1000 else 'request>=1s' if d.get('requestMs',0)>=1000 else 'sum>=1s' if d.get('elapsedMs',0)>=1000 else 'error<1s') for d in failed))}
  r['successfulRequestMinusService']=quant([d['requestMs']-d['serviceTookMs'] for d in success if 'requestMs'in d and 'serviceTookMs'in d])
  r['elapsedDecompositionMaxResidualMs']=max((abs(d['elapsedMs']-d.get('schedulerDelayMs',0)-d.get('requestMs',0)) for d in ds if 'requestMs'in d),default=None)
  for shape in sorted(set(shapes.values())):
   ss=[d for d in ds if shapes[d['queryId']]==shape];r['shapes'][shape]={'requests':len(ss),'strictFailures':sum(fail(d) for d in ss),**groupmetric(ss)}
  # Preserve only one representative per error + one per stage path; no large request archive duplication.
  examples={}
  for d in failed:
   k=d.get('error','slow success')+'|'+','.join(s['phase'] for s in d.get('executionEvidence',{}).get('stages',[]))
   if k not in examples:examples[k]=small(d)
  r['errorExamples']=list(examples.values())
  reports.append(r)
result={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'readOnlySavedEvidence':True,'profiles':reports,'limitations':['Strict failure is union(error,clientRejected,elapsedMs>=1000).','Request minus service duration includes orchestration, PIT requests, transport, parsing and event-loop delay; it is not network latency.','Successful timed requests omit individual stages. Error evidence lists completed phases only; last recorded phase does not identify the failure phase.','Scheduled delay is client admission delay; elapsedMs includes it. No event-loop histogram exists.']}
(OUT/'review.json').write_text(json.dumps(result,indent=2)+'\n')
for p in reports:
 print(p['campaign'],p['candidateId'].replace('favorite-utility-',''),p['rate'],'fail',p['strictFailures'],'delays',p['delayGroups'],'scheduler',p['all']['schedulerDelayMs'],'request',p['all']['requestMs'],'errors',p['errorMessages'])
print('saved',OUT/'review.json')
