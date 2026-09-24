#!/usr/bin/env python3
"""Independent saved-file checks; no scorer imports and no service requests."""
import json, hashlib, pathlib, math, struct, copy, collections, datetime
ROOT=pathlib.Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23')
REPO=pathlib.Path('/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark')
D=ROOT/'pooled-fidelity-v1'
def sha(x): return hashlib.sha256(x).hexdigest()
def js(x): return json.dumps(x,separators=(',',':'),ensure_ascii=False).encode()
def read(p): return json.loads(p.read_bytes())
def filehash(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(1024*1024): h.update(b)
 return h.hexdigest()
def key(x): return (x.get('queryId',x.get('id')),js(x.get('parameters',{})).decode())
def fullkey(x): return key(x)+(x['index'],x['method'],x['limit'])
def f32(x): return struct.unpack('f',struct.pack('f',x))[0]
def hits(response): return [{'id':h.get('fields',{}).get('id',[h.get('_id')])[0],'score':h['_score']} for h in response['hits']['hits']]
def check_hits(rows):
 assert len({h['id'] for h in rows})==len(rows)
 assert all(math.isfinite(h['score']) and h['score']>=0 for h in rows)
 assert rows==sorted(rows,key=lambda h:(-f32(h['score']),h['id']))
def shard_response(row,n):
 assert 'error' not in row and 'error' not in row['response']['body']
 b=row['response']['body'];s=b['_shards'];assert s['total']==s['successful']==n and s['failed']==0
 assert not b.get('timed_out',False)
def clean_body(b): return {k:v for k,v in b.items() if k not in ('pit','timeout')}
def filters(o):
 items=[]
 if 'filter' in o: items.append(o['filter'])
 if o.get('eligibleIds') is not None: items.append({'ids':{'values':o['eligibleIds']}})
 excludes=o.get('excludedIds',[])
 if not items and not excludes: return [{'match_all':{}}]
 value={'filter':items}
 value['must_not']=[{'ids':{'values':excludes}}] if excludes else []
 return [{'bool':value}]

def audit_fidelity():
 f=read(D/'fidelity.json');jobs=read(D/'jobs.json');before=read(D/'index-before.json');after=read(D/'index-after.json');sources=read(D/'source-snapshot.json')
 assert f['passed'] is True and f.get('finishedAt') and not f.get('error')
 assert f['before']==before and f['after']==after
 assert sha(js(sources))==f['sourceSnapshotHash']
 for name,source in sources.items(): assert (REPO/name).read_text()==source,name
 indices=['color-exploration-favorite-points-real-v2','color-exploration-favorite-multishard-real-v1']
 methods=['favorite-utility-bounded-pooled-delete','favorite-utility-maxima-bounded-pooled-delete']
 assert f['configuration']['indices']==indices and f['methods']==methods
 for index,n in zip(indices,[1,3]):
  b=before[index];a=after[index];assert b['generation']==a['generation']
  assert b['count']==a['count']==545 and b['uuid']==a['uuid']
  assert int(b['settings']['number_of_shards'])==n and int(b['settings']['number_of_replicas'])==0
  assert b['mapping']['_meta']['sourceIdentityHash']==f['sourceIdentityHash']
  assert b['mapping']['_meta']['sourceDocumentsHash']==f['documentsHash']
  assert b['mapping']['_meta']['numericPoints'] is True
  assert b['mapping']['properties']['id']['type']=='keyword' and b['mapping']['properties']['id'].get('doc_values',True)
  assert all(x['type']=='float' and x.get('index',True) and x.get('doc_values',True) for x in b['mapping']['properties']['utilities']['properties'].values())
 old=ROOT/'multishard-fidelity-v1/fidelity.json';assert filehash(old)==f['multishardReceiptHash'];assert read(old)['after']['generation']==before[indices[1]]['generation']
 assert len(jobs)==160 and sum(len(x['limits']) for x in jobs)==626
 jobmap={key(j):j for j in jobs};assert len(jobmap)==160
 expected={key(j)+(index,method,limit) for j in jobs for index in indices for method in methods for limit in j['limits']}
 rows={fullkey(r):r for r in f['rows']};assert len(rows)==len(f['rows'])==f['expectedExecutions']==2504 and set(rows)==expected
 refs={};corpus=None
 for line in (D/'references.jsonl').open():
  r=json.loads(line);k=key({'queryId':r['queryId'],'parameters':r['options']['parameters']});assert k in jobmap and k not in refs
  j=jobmap[k];o={k:j[k] for k in ('query','parameters','eligibleIds','excludedIds','filter') if k in j};assert o==r['options']
  assert len(r['trace'])==1;tr=r['trace'][0];assert tr['route']==indices[0]+'/_search?request_cache=false';assert tr['request']['method']=='POST'
  assert clean_body(tr['request']['body'])==r['body'];assert r['body']['size']==1000
  assert set(r['body'])=={'size','_source','track_total_hits','query','sort','stored_fields','docvalue_fields'}
  assert r['body']['query']['bool']['filter']==filters(o), (j['id'],r['body']['query']['bool']['filter'],filters(o))
  shard_response(tr,1);assert hits(tr['response']['body'])==r['reference']['hits'];check_hits(r['reference']['hits'])
  ids={h['id'] for h in r['reference']['hits']}
  if j.get('completeCorpus'):
   assert len(ids)==545
   if corpus is None: corpus=ids
   assert ids==corpus
  if 'eligibleIds' in o: assert ids.issubset(set(o['eligibleIds']))
  assert not ids.intersection(o.get('excludedIds',[]))
  if j['id']=='empty-eligibility': assert len(ids)==0
  if j.get('zeroScores'): assert len(ids)>=2 and all(h['score']==0 for h in r['reference']['hits'])
  refs[k]=r
 assert set(refs)==set(jobmap)
 seen=set();totals=collections.Counter();by_method=collections.defaultdict(collections.Counter)
 for line in (D/'service-traces.jsonl').open():
  t=json.loads(line);k=fullkey(t);assert k in expected and k not in seen;seen.add(k);r=refs[key(t)];row=rows[k]
  result=t['result'];e=result['evidence'];g=e['globalBounds'];trace=t['trace'];n=int(before[t['index']]['settings']['number_of_shards'])
  assert result['hits']==r['reference']['hits'][:t['limit']];check_hits(result['hits'])
  assert row['evidence']==e and row['count']==len(result['hits']) and row['identicalIds'] and row['float32ScoresIdentical'] and row['transportScoresIdentical'] and row['maximumTransportDelta']==0
  assert e['method']==t['method'] and e['index']==t['index'];assert e['parentMethod']==t['method'].removesuffix('-pooled-delete')
  assert g['completeCandidateCoverage'] and g['consistency']=='point-in-time'
  assert e['requestCount']==len(trace)==len(e['stages'])
  assert trace[0]['route']==t['index']+'/_search/point_in_time?keep_alive=60s&allow_partial_pit_creation=false' and trace[0]['request']['method']=='POST'
  shard_response(trace[0],n);pit=trace[0]['response']['body']['pit_id'];pits={pit}
  searches=trace[1:-1];assert all(s['route']=='_search?request_cache=false' and s['request']['method']=='POST' for s in searches)
  reference=copy.deepcopy(r['body']);reference['size']=t['limit'];q=reference['query']['bool'];fields=list(dict.fromkeys(term['function_score']['field_value_factor']['field'] for term in q['should']))
  for s in searches:
   shard_response(s,n);assert s['request']['body']['pit']=={'id':pit}
   p=s['response']['body'].get('pit_id');pit=p or pit;pits.add(pit)
   assert isinstance(s['request']['body']['timeout'],str) and s['request']['body']['timeout'].endswith('ms')
  seeds=[s for s in searches if s['request']['body'].get('track_scores') is False];assert len(seeds)==len(fields)
  seed_ids=[];maxima={}
  for field,s in zip(fields,seeds):
   b=clean_body(s['request']['body']);assert b=={'size':t['limit'],'_source':False,'stored_fields':'_none_','docvalue_fields':['id'],'track_total_hits':False,'track_scores':False,'query':{'bool':{'filter':q['filter']}},'sort':[{field:{'order':'desc','missing':0}},{'id':'asc'}]}
   hs=s['response']['body']['hits']['hits'];ids=[h.get('fields',{}).get('id',[h.get('_id')])[0] for h in hs];assert len(ids)==len(set(ids));assert len(hs)==min(t['limit'],len(r['reference']['hits']))
   for h in hs: assert len(h['sort'])==2 and 0<=h['sort'][0]<=1
   assert hs==sorted(hs,key=lambda h:(-h['sort'][0],h['sort'][1]));maxima.update({field:f32(hs[0]['sort'][0])} if hs else {})
   for ident in ids:
    if ident not in seed_ids: seed_ids.append(ident)
  assert g['seedUnionCount']==len(seed_ids) and g['targetCount']==len(q['should'])
  middle=searches[len(seeds):-1]
  if len(seed_ids)>=t['limit']:
   assert len(middle)==1
   expected_seed=copy.deepcopy(reference);expected_seed['query']['bool']['filter'].append({'ids':{'values':seed_ids}})
   assert clean_body(middle[0]['request']['body'])==expected_seed
   seeded=hits(middle[0]['response']['body']);assert len(seeded)==t['limit'];check_hits(seeded);assert g['kthSeedScore']==seeded[-1]['score']
  else: assert not middle and g['fallback']=='fewer-than-limit-seeds'
  final=copy.deepcopy(reference);positive=g.get('threshold') is not None and g['threshold']>0
  if positive: final['query']['bool']['filter'].append({'bool':{'should':[{'range':{field:{'gte':g['threshold']}}} for field in fields],'minimum_should_match':1}})
  bounds=g.get('maximaBounds')
  if bounds:
   assert bounds['maxima']==maxima,(k,bounds,maxima)
   assert bounds['addedRanges']==sum(x['threshold']>0 for x in bounds['thresholds'])
   for b in bounds['thresholds']:
    assert b['field'] in fields and 0<=b['threshold']<=maxima[b['field']]
    if b['threshold']>0: final['query']['bool']['filter'].append({'range':{b['field']:{'gte':b['threshold']}}})
   if bounds['fallback']=='duplicate-utility-fields': assert not bounds['thresholds'] and len(fields)<len(q['should'])
  assert clean_body(searches[-1]['request']['body'])==final
  assert hits(searches[-1]['response']['body'])==result['hits']
  close=trace[-1];assert close['route']=='_search/point_in_time' and close['request']['method']=='DELETE'
  assert set(close['request']['body'])=={'pit_id'} and set(close['request']['body']['pit_id'])==pits
  assert len(close['request']['body']['pit_id'])==len(pits);assert 'error' not in close and 'error' not in close['response']['body']
  acknowledgements=close['response']['body']['pits'];assert len(acknowledgements)==len(pits) and {a['pit_id'] for a in acknowledgements}==pits and all(a['successful'] is True for a in acknowledgements)
  witness=close['response']['transport'];assert witness=={'kind':'favorite-pooled-pit-delete','version':1,'attempts':1,'reusedSocket':witness['reusedSocket']} and isinstance(witness['reusedSocket'],bool)
  assert e['transport']=={'kind':'favorite-pooled-pit-delete','version':1,'nativeDeleteRequests':1,'nativeDeleteResponses':1,'reusedConnections':int(witness['reusedSocket']),'attempts':1}
  assert row['positiveThresholdApplied']==positive and row['pooledCleanupCount']==1 and row['reusedConnections']==int(witness['reusedSocket'])
  assert row['maximaRanges']==(bounds or {}).get('addedRanges',0) and row['duplicateFallback']==((bounds or {}).get('fallback')=='duplicate-utility-fields')
  for counts in [totals,by_method[t['index']+' / '+t['method']]]:
   counts.update(executions=1,returnedScores=len(result['hits']),positiveBounds=int(positive),maximaRangeExecutions=int(row['maximaRanges']>0),duplicateFallbacks=int(row['duplicateFallback']),nativeCleanups=1,reusedCleanups=int(witness['reusedSocket']),serviceStages=len(trace))
 assert seen==expected
 assert totals['positiveBounds']==f['positiveBounds'] and totals['maximaRangeExecutions']==f['maximaRanges'] and totals['reusedCleanups']==f['reusedCleanups']
 assert f['transport']['nativeDeleteAttempts']==f['transport']['nativeDeleteCompleted']==2504 and f['transport']['nativeDeleteFailed']==f['transport']['inFlight']==0
 report={'schemaVersion':1,'fileOnly':True,'reviewedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'integrityPassed':True,'experimentPassed':True,'errors':[], 'totals':dict(totals),'byIndexAndMethod':dict(by_method),'sourcesVerified':len(sources),'indexGenerations':{index:before[index]['generation'] for index in indices},'referenceJobs':160,'presets':9,'hashes':{name:filehash(D/name) for name in ['fidelity.json','jobs.json','source-snapshot.json','index-before.json','index-after.json','references.jsonl','service-traces.jsonl']},'auditorHash':filehash(pathlib.Path(__file__)),'limitations':['File-only re-evaluation of saved complete rankings and HTTP-stage traces, not a new service run or independent reimplementation of color extraction.','Same preserved numeric objective including its known duplicate-target arithmetic defect; duplicate tests verify transport/fallback parity, not a correction.','545 assets (523 real and 22 synthetic); three primaries share one physical node. No million-document capacity or multi-node claim.','Pool snapshot precedes finally-close and reports one idle HTTP socket; every created/rotated PIT has a successful DELETE acknowledgement.']}
 with (D/'audit-independent-v1.json').open('x') as out: json.dump(report,out,indent=2);out.write('\n')
 print(json.dumps({'fidelityAudit':True,**dict(totals),'sourcesVerified':len(sources)}))

def audit_feedback():
 runfile=pathlib.Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-23T18-36-10.447Z-84f622c2/run.json');run=read(runfile)
 proof=[];source_count=0
 for c in run['candidates']:
  for name,expected in {**run['runnerSourceHashes'],**c['sourceHashes']}.items(): assert filehash(REPO/name)==expected,name;source_count+=1
  samples=[];witnesses=0;reuse=0;requests=collections.Counter()
  for case in c['cases']:
   if case['status']=='unsupported': assert not case['hits'];continue
   assert case['status']=='ok';p=case['performance'];assert p['sampleCount']==len(p['trials'])==len(p['samplesMs'])==3
   assert p['samplesMs']==[r['elapsedMs'] for r in p['trials']];samples.extend(p['samplesMs']);assert all(not r.get('error') and r['elapsedMs']<1000 and r['hits']==case['hits'][:20] for r in p['trials'])
   if c['id'].endswith('-pooled-delete'):
    e=case['searchEvidence']['evidence'];transport=e['transport'];stages=[s['phase'] for s in e['stages']]
    assert e['method']==c['id'] and e['parentMethod']==c['id'].removesuffix('-pooled-delete')
    assert stages[0]=='pit-open' and stages[-1]=='pit-close' and 'global-final' in stages and e['requestCount']==len(stages)
    assert e['globalBounds']['consistency']=='point-in-time' and e['globalBounds']['completeCandidateCoverage']
    assert e['globalBounds']['fallback']=='fewer-than-limit-seeds' and e['globalBounds']['threshold'] is None
    assert transport['kind']=='favorite-pooled-pit-delete' and transport['version']==1 and transport['nativeDeleteRequests']==transport['nativeDeleteResponses']==transport['attempts']==1
    assert transport['reusedConnections'] in [0,1];reuse+=transport['reusedConnections'];witnesses+=1;requests[e['requestCount']]+=1
    if 'maxima' in c['id']: assert 'maximaBounds' in e['globalBounds']
  assert len(samples)==96
  if c['id'].endswith('-pooled-delete'): assert witnesses==32 and reuse>=31 and c['configuration']['module']=='./favorite-pooled-adapter.mjs'
  proof.append({'id':c['id'],'timedSamples':len(samples),'timedFailures':sum(x>=1000 for x in samples),'savedAccuracyExecutions':witnesses,'nativeCleanupWitnesses':witnesses,'reusedAccuracyCleanups':reuse,'requestCounts':dict(requests)})
 report={'fileOnly':True,'reviewedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'verified':True,'runFile':str(runfile),'runSha256':filehash(runfile),'candidateSourceHashChecks':source_count,'candidates':proof,'auditorHash':filehash(pathlib.Path(__file__)),'limitations':['All32 saved accuracy calls per pooled candidate contain actual native transport witnesses. These limit1000 calls cover only545 assets and intentionally use the full-query fallback.','Each candidate has96 timed requests of up to20 hits, each matching its saved full-query prefix. Timed feedback trials omit executor-stage traces; matching frozen runner/adapter source binds the same execution path, but timed cleanup witnesses cannot be reconstructed.','Human agreement is independently audited separately in pooled-feedback-independent-audit-v1.json. These timings are feedback integration diagnostics, not capacity evidence.']}
 with (ROOT/'pooled-feedback-execution-path-audit-v1.json').open('x') as out: json.dump(report,out,indent=2);out.write('\n')
 print(json.dumps({'feedbackPathAudit':True,'candidates':proof}))
if __name__=='__main__': audit_feedback()
