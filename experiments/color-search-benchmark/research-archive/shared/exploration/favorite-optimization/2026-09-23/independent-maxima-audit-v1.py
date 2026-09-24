#!/usr/bin/env python3
"""Independent file-only audit of maxima execution, bounds and recorded counts."""
from pathlib import Path
import collections,datetime,hashlib,json,math,struct
ROOT=Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23');D=ROOT/'maxima-fidelity-v1'
def load(p):return json.loads(p.read_text())
def lines(p):
 with p.open() as f:
  for line in f:
   if line.strip():yield json.loads(line)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def key(r):return r['queryId'],json.dumps(r.get('parameters',r.get('options',{}).get('parameters')),sort_keys=True,separators=(',',':'))
def f32(v):return struct.unpack('>f',struct.pack('>f',v))[0]
def bits(v):return struct.unpack('>I',struct.pack('>f',v))[0]
def val(v):return struct.unpack('>f',struct.pack('>I',v))[0]
def nxt(v):return val(bits(v)+1) if v else 2**-149
def hitid(h):return h['fields']['id'][0] if h.get('fields',{}).get('id') else h['_id']
def seedcalls(trace):return [c for c in trace if c['request'].get('body',{}).get('track_scores') is False]
def upper(clauses,maxima,field,x):
 return nxt(f32(math.fsum(nxt(f32((x if c['field']==field else maxima[c['field']])*f32(c['factor']))) for c in clauses)))
r=load(D/'fidelity.json');assert r['passed'] and r['finishedAt'] and not r.get('error')
assert r['before']['generation']==r['after']['generation'];assert r['before']['count']==545
source=load(D/'source-snapshot.json');sourcehash=hashlib.sha256(json.dumps(source,ensure_ascii=False,separators=(',',':')).encode()).hexdigest();assert sourcehash==r['sourceSnapshotHash']
references={key(v):v for v in lines(D/'references.jsonl')};saved={(key(v),v['limit']):v for v in r['rows']};counts={(key(v),v['limit']):v for v in lines(D/'candidate-counts.jsonl')}
# Reconstruct every needed per-document utility solely from full-corpus seed sorts.
values={}
for trace in lines(D/'service-traces.jsonl'):
 if trace['limit']!=1000:continue
 for call in seedcalls(trace['trace']):
  field=next(iter(call['request']['body']['sort'][0]));observed={hitid(h):f32(h['sort'][0]) for h in call['response']['body']['hits']['hits']}
  assert len(observed)==545 and all(math.isfinite(v) and 0<=v<=1 for v in observed.values())
  if field in values:assert values[field]==observed
  else:values[field]=observed
seen=set();totals=dict(executions=0,documentScores=0,exactOrdersAndScores=0,positiveBounds=0,maximaRanges=0,additionallyPrunedExecutions=0,maximumAdditionalPruned=0,winnersAndTiesChecked=0,duplicateFallbacks=0)
groups=collections.defaultdict(lambda:dict(executions=0,currentCandidateVisits=0,proposedCandidateVisits=0,improvedExecutions=0))
for trace in lines(D/'service-traces.jsonl'):
 identity=(key(trace),trace['limit']);assert identity not in seen;seen.add(identity)
 assert trace['method']=='favorite-utility-maxima-bounded';row=saved[identity];ref=references[identity[0]];actual=trace['result']['hits'];expected=ref['reference']['hits'][:trace['limit']]
 assert actual==expected;assert row['count']==len(actual) and row['identicalIds'] and row['transportScoresIdentical'];assert row['evidence']==trace['result']['evidence']
 totals['executions']+=1;totals['documentScores']+=len(actual);totals['exactOrdersAndScores']+=1
 original=ref['body'];originalFilters=original['query']['bool']['filter'];clauses=[c['function_score']['field_value_factor'] for c in original['query']['bool']['should']];fields=list(dict.fromkeys(c['field'] for c in clauses))
 calls=trace['trace'];assert not any(c.get('error') for c in calls);searches=[c for c in calls if c['route'].startswith('_search?')];seeds=seedcalls(calls);assert len(seeds)==len(fields)
 pit=calls[0]['response']['body']['pit_id'];pits={pit}
 for call in searches:
  assert call['request']['body']['pit']['id']==pit
  pit=call['response']['body'].get('pit_id',pit);pits.add(pit)
 close=calls[-1];assert close['request']['method']=='DELETE' and set(close['request']['body']['pit_id'])==pits
 assert all(any(p['pit_id']==pit and p['successful'] for p in close['response']['body']['pits']) for pit in pits)
 body=searches[-1]['request']['body'];assert body['query']['bool']['should']==original['query']['bool']['should'];assert body['query']['bool']['must']==original['query']['bool']['must'];assert body['sort']==original['sort'] and body['size']==trace['limit']
 assert body['query']['bool']['filter'][:len(originalFilters)]==originalFilters;assert body['stored_fields']=='_none_' and body['docvalue_fields']==['id']
 rawhits=[dict(id=hitid(h),score=h['_score']) for h in searches[-1]['response']['body']['hits']['hits']];assert rawhits==actual
 b=trace['result']['evidence']['globalBounds'];m=b['maximaBounds'];assert b['completeCandidateCoverage'] and b['consistency']=='point-in-time'
 eligible=ref['reference']['hits'];maxima={}
 for field,call in zip(fields,seeds):
  request=call['request']['body'];assert request['query']=={'bool':{'filter':originalFilters}}
  assert request['sort']==[{field:{'order':'desc','missing':0}},{'id':'asc'}]
  hits=call['response']['body']['hits']['hits']
  if hits:
   maximum=f32(hits[0]['sort'][0]);assert maximum==m['maxima'][field]==max(values[field][h['id']] for h in eligible);maxima[field]=maximum
 extras=body['query']['bool']['filter'][len(originalFilters):];current=eligible;proposed=eligible
 if b['threshold'] is not None and b['threshold']>0:
  totals['positiveBounds']+=1;lower=f32(b['kthSeedScore']);t=b['threshold']
  expected_or={'bool':{'should':[{'range':{field:{'gte':t}}} for field in fields],'minimum_should_match':1}};assert extras[0]==expected_or
  assert extras[1:]==[{'range':{x['field']:{'gte':x['threshold']}}} for x in m['thresholds']];assert m['addedRanges']==len(m['thresholds'])
  if len(fields)!=len(clauses):assert m['fallback']=='duplicate-utility-fields' and not m['thresholds'];totals['duplicateFallbacks']+=1
  for condition in m['thresholds']:
   field=condition['field'];threshold=condition['threshold'];assert field in fields and 0<threshold<=maxima[field] and f32(threshold)==threshold
   assert upper(clauses,maxima,field,val(bits(threshold)-1))<lower,'Unsafe necessary threshold'
   assert upper(clauses,maxima,field,threshold)>=lower
  current=[h for h in eligible if any(values[field][h['id']]>=t for field in fields)]
  proposed=[h for h in current if all(values[x['field']][h['id']]>=x['threshold'] for x in m['thresholds'])]
  ids={h['id'] for h in proposed};winners=[h for h in eligible if f32(h['score'])>=lower];assert all(h['id'] in ids for h in winners);totals['winnersAndTiesChecked']+=len(winners)
 else:assert not extras and not m['thresholds']
 count=counts[identity];assert count['totalEligible']==len(eligible) and count['orEligible']==len(current) and count['finalEligible']==len(proposed)
 assert count['originalPruned']==len(eligible)-len(current) and count['additionallyPruned']==len(current)-len(proposed) and count['totalPruned']==len(eligible)-len(proposed)
 assert row['pruning']=={k:v for k,v in count.items() if k not in ['queryId','parameters','method','limit','trace']}
 for c in count['trace']:
  assert c['route']==r['configuration']['index']+'/_count' and not c['response']['body'].get('_shards',{}).get('failed')
  filters=c['request']['body']['query']['bool']['filter'];expected_count=len(current) if filters==originalFilters+extras[:1] else len(proposed)
  assert filters in [originalFilters+extras[:1],originalFilters+extras];assert c['response']['body']['count']==expected_count
 totals['maximaRanges']+=bool(m['addedRanges']);extra=len(current)-len(proposed);totals['additionallyPrunedExecutions']+=extra>0;totals['maximumAdditionalPruned']=max(totals['maximumAdditionalPruned'],extra)
 group=groups[str(len(clauses))];group['executions']+=1;group['currentCandidateVisits']+=len(current);group['proposedCandidateVisits']+=len(proposed);group['improvedExecutions']+=extra>0
assert len(seen)==len(saved)==len(counts)==r['expectedExecutions']==626;assert len(references)==len(r['references'])==160
assert totals['positiveBounds']==r['positiveBoundExecutions'];assert totals['maximaRanges']==r['maximaRangeExecutions'];assert totals['additionallyPrunedExecutions']==r['additionallyPrunedExecutions']
receipt=dict(kind='maxima-execution',auditedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),integrityPassed=True,experimentPassed=True,sourceSnapshotHash=sourcehash,summaryHash=digest(D/'fidelity.json'),auditCodeHash=digest(Path(__file__)),referenceCases=len(references),fullUtilityFields=len(values),**totals,groups=dict(groups),limitations=['Independent saved-evidence audit; no service calls or new relevance labels.','Known duplicate-target arithmetic defect is retained and conservatively falls back to original bounds.','Count queries occur after PIT closure and are validated against unchanged index generations and reconstructed utility eligibility.'])
with (D/'audit-independent-v1.json').open('x') as f:json.dump(receipt,f,indent=2)
print(json.dumps(receipt))
