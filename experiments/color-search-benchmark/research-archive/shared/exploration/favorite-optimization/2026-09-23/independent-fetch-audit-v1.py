#!/usr/bin/env python3
"""Audit archived transport parity and paired fetch timings without service calls."""
from pathlib import Path
import collections,datetime,hashlib,json,math,statistics,struct
ROOT=Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23');D=ROOT/'fetch-fidelity-v1'
def load(p):return json.loads(p.read_text())
def rows(p):
 with p.open() as f:
  for line in f:
   if line.strip():yield json.loads(line)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def key(r):return r['queryId'],json.dumps(r['parameters'],sort_keys=True,separators=(',',':'))
def f32(v):return struct.unpack('f',struct.pack('f',v))[0]
def comparable(hits):return [(h['id'],f32(h['score'])) for h in hits]
def same(a,b):assert math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-12),(a,b)
r=load(D/'fidelity.json');assert r['passed'] and r['finishedAt'] and r['before']==r['after']
sources=load(D/'source-snapshot.json');source_hash=hashlib.sha256(json.dumps(sources,ensure_ascii=False,separators=(',',':')).encode()).hexdigest();assert source_hash==r['sourceSnapshotHash']
references={}
for name,meta in r['references'].items():
 assert digest(Path(meta['filename']))==meta['sha256'];assert digest(Path(meta['receiptFile']))==meta['receiptSha256']
 archived=load(D/('reference-'+name+'.json'));assert archived['receipt']==load(Path(meta['receiptFile']));assert archived['rows']==list(rows(Path(meta['filename'])))
 assert archived['receipt']['passed'];references[name]={key(row):row for row in archived['rows']};assert len(references[name])==144
 for index in r['before'].values():
  assert index['count']==545 and index['uuid'];assert index['metadata']['sourceDocumentsHash']==meta['documentValuesHash'];assert index['metadata']['sourceIdentityHash']==meta['sourceIdentityHash']
variants={v['id']:v for v in r['variants']};reported={(key(v),v['method']):v for v in r['rows']};requests={(key(v),v['method']):v for v in rows(D/'requests.jsonl')}
numeric_requests={key(v):v['numericBody'] for v in rows(ROOT/'execution-fidelity/references.jsonl')}
precision_requests={key(v):v['precision']['favorite-utility-rank27'] for v in rows(ROOT/'precision-fidelity/requests.jsonl')}
counts=collections.defaultdict(lambda:dict(comparisons=0,documentScores=0,identicalOrdersAndFloat32Scores=0,identicalRawScores=0));seen=set()
for v in rows(D/'rankings.jsonl'):
 identity=(key(v),v['method']);assert identity not in seen;seen.add(identity);variant=variants[v['method']];ref=references[variant['reference']][key(v)]
 expected=ref['rankings']['favorite-utility-rank27' if variant['reference']=='precision' else 'favorite-utility-numeric'];assert v['expected']==expected
 actual=v['actual']['hits'];assert len(actual)==545==len({h['id'] for h in actual});assert comparable(actual)==comparable(expected)
 row=reported[identity];assert row['count']==545 and row['identicalFloat32ScoresAndIds'];assert row['rawScoresIdentical']==(actual==expected);assert row['evidence']==v['actual']['evidence']
 request=v['request'];assert requests[identity]['request']==request and request['stored_fields']=='_none_' and request['docvalue_fields']==['id'] and request['_source'] is False
 stripped={k:value for k,value in request.items() if k not in ['stored_fields','docvalue_fields']}
 parent=precision_requests[key(v)] if variant['reference']=='precision' else json.loads(json.dumps(numeric_requests[key(v)]))
 if variant['parent']=='favorite-utility-sorted' and len(parent['query']['bool']['should'])==1:
  field=parent['query']['bool']['should'][0]['function_score']['field_value_factor']['field'];parent['sort']=[{field:{'order':'desc','missing':0}},{'id':'asc'}];parent['track_scores']=False
 assert stripped==parent,('Fetch changes more than fetch',identity)
 c=counts[v['method']];c['comparisons']+=1;c['documentScores']+=545;c['identicalOrdersAndFloat32Scores']+=1;c['identicalRawScores']+=actual==expected
assert len(seen)==len(reported)==len(requests)==432
pairs={}
for v in rows(D/'diagnostics.jsonl'):
 identity=(v['queryId'],v['method'],v['limit']);pair=pairs.setdefault(identity,{});assert v['fetch'] not in pair;pair[v['fetch']]=v
assert len(pairs)==len(r['diagnostics'])==24;diagnostic_groups=collections.defaultdict(list)
for d in r['diagnostics']:
 p=pairs[(d['queryId'],d['method'],d['limit'])];assert set(p)=={'stored','docvalues'}
 assert comparable(p['stored']['hits'])==comparable(p['docvalues']['hits']);assert len(p['stored']['hits'])==(20 if d['limit']==20 else 545)
 for mode in ['stored','docvalues']:
  assert math.isfinite(p[mode]['elapsedMs']) and p[mode]['elapsedMs']>=0;same(p[mode]['elapsedMs'],d[mode]['elapsedMs'])
  for k,val in p[mode]['evidence'].items():assert d[mode][k]==val
 diagnostic_groups[(d['method'],d['limit'])].append(d)
summary=[]
for (method,limit),ds in diagnostic_groups.items():
 group=dict(method=method,limit=limit,returned=20 if limit==20 else 545,pairs=len(ds))
 for mode in ['stored','docvalues']:
  times=[d[mode]['elapsedMs'] for d in ds];group[mode]=dict(minMs=min(times),medianMs=statistics.median(times),maxMs=max(times),atLeastOneSecond=sum(x>=1000 for x in times))
 group['docvaluesFasterPairs']=sum(d['docvalues']['elapsedMs']<d['stored']['elapsedMs'] for d in ds);summary.append(group)
receipt=dict(kind='fetch-transport',auditedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),integrityPassed=True,experimentPassed=r['passed'],sourceSnapshotHash=source_hash,summaryHash=digest(D/'fidelity.json'),auditCodeHash=digest(Path(__file__)),comparisons=432,documentScores=432*545,methods=dict(counts),pairedDiagnostics=24,diagnosticGroups=summary,limitations=['Independent audit of saved responses, body identity and source/reference hashes; no service calls.','Four query shapes and one alternating pair per shape/limit/method; diagnostics are not capacity or representative latency percentiles.'])
with (D/'audit-independent-v1.json').open('x') as f:json.dump(receipt,f,indent=2)
print(json.dumps(receipt))
