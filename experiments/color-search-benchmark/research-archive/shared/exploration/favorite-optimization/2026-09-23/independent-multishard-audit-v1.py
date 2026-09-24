import json, hashlib, struct, collections
from pathlib import Path
R=Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/multishard-fidelity-v1')
compact=lambda x:json.dumps(x,ensure_ascii=False,separators=(',',':'))
sha=lambda b:hashlib.sha256(b).hexdigest()
f32=lambda x:struct.unpack('!f',struct.pack('!f',x))[0]
read=lambda name:json.loads((R/name).read_text())
lines=lambda name:[json.loads(s) for s in (R/name).read_text().splitlines()]
key=lambda x:(x['queryId'],compact(x['parameters']))
f=read('fidelity.json'); assert f['passed'] is True
source=read('source-snapshot.json'); assert sha(compact(source).encode())==f['sourceSnapshotHash']
rawdocs=(R/'documents.ndjson').read_bytes(); assert sha(rawdocs)==f['documentsHash']
doclines=rawdocs.decode().splitlines(); docs=[json.loads(s) for s in doclines]; byid={d['id']:d for d in docs}; rawbyid={d['id']:s for d,s in zip(docs,doclines)}
assert len(docs)==len(byid)==545 and sha(compact([d['id'] for d in docs]).encode())==f['orderedIdsHash']
assert all(len(d['utilities'])==189 for d in docs)
bulks=lines('bulk.jsonl'); ack=[]
for row in bulks:
    body=''.join(compact({'create':{'_id':i}})+'\n'+rawbyid[i]+'\n' for i in row['ids'])
    assert sha(body.encode())==row['bodyHash'] and len(body.encode())==row['bytes']
    items=row['response']['body']['items']; assert row['acknowledged'] and not row['response']['body']['errors']
    assert len(items)==len(row['ids'])
    for i,item in zip(row['ids'],items):
        assert set(item)=={'create'} and item['create']['_id']==i and item['create']['status']==201; ack.append(i)
assert len(ack)==545 and set(ack)==set(byid)
shards=lines('shards.jsonl'); shardids=[i for shard in shards for i in shard['ids']]
assert len(shards)==3 and all(shard['ids'] for shard in shards)
assert len(shardids)==len(set(shardids))==545 and set(shardids)==set(byid)
assert [len(s['ids']) for s in shards]==f['shardCounts']
for s in shards:
    assert s['response']['body']['_shards']['total']==1
    assert s['ids']==[h['fields']['id'][0] for h in s['response']['body']['hits']['hits']]
assert f['before']['generation']==f['after']['generation'] and f['referenceBefore']['generation']==f['referenceAfter']['generation']
assert f['before']['settings']['number_of_shards']=='3' and f['before']['settings']['number_of_replicas']=='0'
assert len(f['physicalNodes'])==1

def value(doc,field):
    for p in field.split('.'):doc=doc[p]
    return doc

def matches(doc,q):
    if 'match_all' in q:return True
    if 'match_none' in q:return False
    if 'ids' in q:return doc['id'] in q['ids']['values']
    if 'term' in q:return all(value(doc,k)==v for k,v in q['term'].items())
    if 'range' in q:
        for field,bounds in q['range'].items():
            v=f32(value(doc,field))
            for op,t in bounds.items():
                assert op in ['gte','gt','lte','lt']
                if not {'gte':v>=t,'gt':v>t,'lte':v<=t,'lt':v<t}[op]:return False
        return True
    if 'bool' in q:
        b=q['bool']; allowed={'filter','must','must_not','should','minimum_should_match'};assert set(b)<=allowed
        seq=lambda k:b.get(k,[]) if isinstance(b.get(k,[]),list) else [b[k]]
        return all(matches(doc,x) for x in seq('filter')+seq('must')) and not any(matches(doc,x) for x in seq('must_not')) and sum(matches(doc,x) for x in seq('should'))>=b.get('minimum_should_match',0)
    raise AssertionError(q)

def check_response(call,shard_count):
    b=call['response']['body']; assert not b.get('timed_out',False)
    if '_shards' in b: assert b['_shards']['total']==shard_count and b['_shards']['successful']==shard_count and b['_shards']['failed']==0

def service_hits(call):
    body=call['request']['body']; sorted_score=body.get('track_scores') is False
    return [{'id':h['fields']['id'][0], 'score':h['sort'][0] if sorted_score else h['_score']} for h in call['response']['body']['hits']['hits']]

refs={}; oracle_scores=0
for row in lines('references.jsonl'):
    k=key(row); assert k not in refs; refs[k]=row
    assert len(row['trace'])==1
    call=row['trace'][0]; check_response(call,1); assert service_hits(call)==row['result']['hits']
    b=call['request']['body']['query']['bool']; terms={compact(t):t for t in b['should']}.values()
    eligible=[d for d in docs if all(matches(d,q) for q in b['filter'])]
    scored=[]
    for d in eligible:
        # Preserved engine behavior deduplicates equal SHOULD clauses. This is
        # explicitly an oracle for the known existing behavior, not its correction.
        score=f32(sum(f32(f32(value(d,t['function_score']['field_value_factor']['field']))*f32(t['function_score']['field_value_factor']['factor'])) for t in terms))
        scored.append({'id':d['id'],'score':score})
    scored.sort(key=lambda h:(-h['score'],h['id']))
    actual=row['result']['hits']; assert [h['id'] for h in scored]==[h['id'] for h in actual]
    assert all(e['score']==f32(a['score']) for e,a in zip(scored,actual));oracle_scores+=len(scored)
assert len(refs)==160
counts=collections.Counter(); returned=0; positives=0; maxranges=0; duplicate_fallbacks=0; final_candidate_total=0
seen=set(); winning_scores_retained=0
for row in lines('service-traces.jsonl'):
    k=key(row); ref=refs[k]; unique=(k,row['method'],row['limit']);assert unique not in seen;seen.add(unique)
    assert row['method'] in f['methods'] and row['limit'] in [20,3,545]
    expected=ref['result']['hits'][:row['limit']]; actual=row['result']['hits']
    assert [h['id'] for h in expected]==[h['id'] for h in actual]
    assert all(f32(a['score'])==f32(e['score']) for a,e in zip(actual,expected))
    if row['method']!='favorite-utility-sorted-docvalues':assert actual==expected
    searches=[c for c in row['trace'] if '_search?' in c['route']]
    for c in searches:check_response(c,3)
    final=searches[-1]; assert service_hits(final)==actual
    rb=ref['trace'][0]['request']['body']['query']['bool']; fb=final['request']['body']['query']['bool']
    assert fb['should']==rb['should'] and fb['must']==rb['must'] and fb['minimum_should_match']==rb['minimum_should_match']
    assert fb['filter'][:len(rb['filter'])]==rb['filter']
    kept=[d for d in docs if all(matches(d,q) for q in fb['filter'])];final_candidate_total+=len(kept)
    keptids={d['id'] for d in kept}; assert all(h['id'] in keptids for h in expected)
    if 'bounded' in row['method']:
        trace=row['trace']; create=trace[0];check_response(create,3)
        assert create['request']['method']=='POST' and '/_search/point_in_time?' in create['route']
        pit=create['response']['body']['pit_id']; pits={pit}
        for c in searches:
            assert c['request']['body']['pit']['id']==pit
            pit=c['response']['body'].get('pit_id',pit);pits.add(pit)
        close=trace[-1];assert close['request']['method']=='DELETE'
        assert set(close['request']['body']['pit_id'])==pits
        assert all(any(p['pit_id']==i and p['successful'] for p in close['response']['body']['pits']) for i in pits)
        bounds=row['result']['evidence']['globalBounds'];assert bounds['completeCandidateCoverage'] and bounds['consistency']=='point-in-time'
        if bounds['threshold'] is not None and bounds['threshold']>0: positives+=1
        if bounds.get('maximaBounds',{}).get('addedRanges'):maxranges+=1
        if k[0].startswith('duplicate-') and bounds['threshold'] is not None and bounds['threshold']>0 and 'maxima' in row['method']:
            assert bounds['maximaBounds']['fallback']=='duplicate-utility-fields';duplicate_fallbacks+=1
        lower=bounds.get('seedLowerBound')
        if lower is not None:
            winners=[h for h in ref['result']['hits'] if f32(h['score'])>=f32(lower)]
            assert all(h['id'] in keptids for h in winners);winning_scores_retained+=len(winners)
    else:assert fb['filter']==rb['filter']
    returned+=len(actual);counts[row['method']]+=1
assert len(seen)==f['expectedExecutions']==len(f['rows'])==1920
assert counts=={m:480 for m in f['methods']}
assert positives==f['positiveBoundExecutions'] and maxranges==f['maximaRangeExecutions'] and duplicate_fallbacks==f['duplicateFallbacks']
assert returned==sum(row['count'] for row in f['rows'])
result={'schemaVersion':1,'kind':'multishard-execution','passed':True,'experiment':'independent-multishard-file-audit',
 'summarySha256':sha((R/'fidelity.json').read_bytes()),'sourceSnapshotHash':f['sourceSnapshotHash'],
 'documents':545,'utilityFields':189,'bulk201Acknowledgements':len(ack),'shardCounts':f['shardCounts'],'physicalNodeCount':1,
 'referenceCases':len(refs),'referenceOracleScores':oracle_scores,'executions':len(seen),'executionsByMethod':dict(counts),'returnedScores':returned,
 'positiveBoundExecutions':positives,'maximaRangeExecutions':maxranges,'duplicateFallbacks':duplicate_fallbacks,
 'finalCandidateTotal':final_candidate_total,'winningScoresRetained':winning_scores_retained,
 'checks':['archived source hash','encoded document hash','each bulk create body and201','complete disjoint shard inventory','unchanged index generations','independent stored-float32 reference oracle with preserved duplicate behavior','exact global IDs/order and float32 scores','actual final service hit transport','all global search shard success','PIT rotation and closure','unchanged score terms and metadata','final ranges retain global reference winners'],
 'limitations':['One physical node with three logical primary shards; no multi-node failure or network test.','Correctness only, not timing or capacity.','Preserves the known duplicate-target arithmetic defect.','Uses the same saved measurements and encoded utility documents, not an independent extractor.']}
with (R/'audit-independent-v1.json').open('x') as out:json.dump(result,out,indent=2)
print(json.dumps(result,indent=2))
