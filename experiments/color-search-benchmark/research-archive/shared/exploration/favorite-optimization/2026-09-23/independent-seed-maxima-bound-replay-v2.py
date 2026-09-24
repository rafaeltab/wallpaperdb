#!/usr/bin/env python3
"""File-only proposed bound replay; never executes a search or ranks results."""
from pathlib import Path
import collections,datetime,hashlib,json,math,struct
ROOT=Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23')
SOURCE=ROOT/'execution-fidelity'
def rows(name):
 with (SOURCE/name).open() as f:
  for line in f:
   if line.strip():yield json.loads(line)
def key(row):return row['queryId'],json.dumps(row['parameters'],sort_keys=True,separators=(',',':'))
def f32(v):return struct.unpack('>f',struct.pack('>f',v))[0]
def bits(v):return struct.unpack('>I',struct.pack('>f',v))[0]
def value(v):return struct.unpack('>f',struct.pack('>I',v))[0]
def nxt(v):return value(bits(v)+1)
def hitid(hit):return hit['fields']['id'][0] if hit.get('fields',{}).get('id') else hit['_id']
def sorted_calls(trace):return [call for call in trace if any(isinstance(s,dict) and any(k.startswith('utilities.') for k in s) for s in call['request'].get('body',{}).get('sort',[]))]
# Full-corpus seed sorts are already archived for all regular query presets.
values={}
for trace in rows('service-traces.jsonl'):
 if trace['method']!='favorite-utility-bounded' or trace['limit']!=1000:continue
 for call in sorted_calls(trace['trace']):
  field=next(iter(call['request']['body']['sort'][0]));observed={hitid(h):f32(h['sort'][0]) for h in call['response']['body']['hits']['hits']}
  assert len(observed)==545 and all(0<=v<=1 and math.isfinite(v) for v in observed.values())
  if field in values:assert observed==values[field]
  else:values[field]=observed
references={key(r):r for r in rows('references.jsonl')}
saved=json.loads((SOURCE/'fidelity.json').read_text())
saved_bounds={(key(r),r['limit']):r['bounds'] for r in saved['rows'] if r['method']=='favorite-utility-bounded'}
def upper(field,x,clauses,maxima):
 # Outward float32 rounding covers products and the final sum, plus the existing
 # executor's extra product ULP for positive duplicate-clause grouping.
 products=[nxt(f32((x if c['field']==field else maxima[c['field']])*f32(c['factor']))) for c in clauses]
 return nxt(f32(math.fsum(products)))
def threshold(field,clauses,maxima,t):
 if upper(field,0,clauses,maxima)>=t:return 0.0
 if upper(field,1,clauses,maxima)<t:raise AssertionError('Impossible seed lower bound')
 low,high=0,bits(1)
 while low<high:
  mid=(low+high)//2
  if upper(field,value(mid),clauses,maxima)>=t:high=mid
  else:low=mid+1
 return value(low)
results=[]
for trace in rows('service-traces.jsonl'):
 if trace['method']!='favorite-utility-bounded':continue
 bounds=trace['result']['evidence']['globalBounds'];t=bounds['threshold']
 if t is None:continue
 reference=references[key(trace)];clauses=[c['function_score']['field_value_factor'] for c in reference['numericBody']['query']['bool']['should']]
 maxima={}
 for call in sorted_calls(trace['trace']):
  hits=call['response']['body']['hits']['hits'];assert hits
  field=next(iter(call['request']['body']['sort'][0]));maxima[field]=f32(hits[0]['sort'][0])
 eligible=reference['numeric']['hits'];fields=list(maxima);lower=f32(bounds['kthSeedScore'])
 for field in fields:assert maxima[field]==max(values[field][h['id']] for h in eligible)
 thresholds={field:threshold(field,clauses,maxima,lower) for field in fields}
 current=[h for h in eligible if any(values[f][h['id']]>=t for f in fields)]
 assert len(current)==saved_bounds[(key(trace),trace['limit'])]['boundEligibleCount']
 assert len(eligible)==saved_bounds[(key(trace),trace['limit'])]['totalEligibleCount']
 proposed=[h for h in current if all(values[f][h['id']]>=thresholds[f] for f in fields)]
 proposed_ids={h['id'] for h in proposed};winners=[h for h in eligible if f32(h['score'])>=lower]
 assert all(h['id'] in proposed_ids for h in winners),'Proposed bound lost a winner or tie'
 assert all(h['id'] in proposed_ids for h in trace['result']['hits']),'Proposed bound lost a top-K result'
 results.append(dict(queryId=trace['queryId'],parameters=trace['parameters'],limit=trace['limit'],targets=len(clauses),fields=len(fields),lowerBound=lower,maxima=maxima,thresholds=thresholds,
  eligible=len(eligible),currentCandidates=len(current),proposedCandidates=len(proposed),extraPruned=len(current)-len(proposed),winnersAndTies=len(winners)))
groups={}
for n in sorted({r['targets'] for r in results}):
 rs=[r for r in results if r['targets']==n];groups[str(n)]=dict(executions=len(rs),improvedExecutions=sum(r['extraPruned']>0 for r in rs),currentCandidateVisits=sum(r['currentCandidates'] for r in rs),proposedCandidateVisits=sum(r['proposedCandidates'] for r in rs),maximumExtraPruned=max(r['extraPruned'] for r in rs))
out=dict(schemaVersion=1,kind='offline-seed-maxima-bound-replay',createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),passed=True,sourceSummaryHash=hashlib.sha256((SOURCE/'fidelity.json').read_bytes()).hexdigest(),scriptHash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),fullCorpusUtilityFields=len(values),checkedExecutions=len(results),groups=groups,rows=results,limitations=['Offline eligibility analysis of saved 545-document service results; no query timing, no new service calls, no scale/selectivity guarantee.','Retains the current numeric service objective including its duplicate-target defect; a correction requires fresh proof and fidelity checks.'])
output=ROOT/'seed-maxima-bound-replay-v2.json'
with output.open('x') as f:json.dump(out,f,indent=2)
print(json.dumps({k:v for k,v in out.items() if k!='rows'}))
