#!/usr/bin/env python3
"""Independent saved-evidence audit: no repository imports or network calls."""
import argparse, bisect, collections, datetime, hashlib, json, math, pathlib, struct

def load(file): return json.loads(pathlib.Path(file).read_text())
def lines(file):
    with pathlib.Path(file).open() as stream:
        for line in stream:
            if line.strip(): yield json.loads(line)
def digest(file): return hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()
def key(row): return row['queryId'], json.dumps(row['parameters'], sort_keys=True, separators=(',', ':'))
def same_number(a,b):
    assert math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-14), (a,b)
def f32(value): return struct.unpack('f',struct.pack('f',value))[0]
def ranks(reference, actual):
    ids=[h['id'] for h in reference]; aids=[h['id'] for h in actual]; n=len(ids)
    assert n == len(set(ids)) == len(aids) == len(set(aids)) and set(ids)==set(aids)
    assert all(math.isfinite(h['score']) for h in reference+actual)
    assert all(a['score'] >= b['score'] for a,b in zip(reference,reference[1:]))
    assert all(a['score'] >= b['score'] for a,b in zip(actual,actual[1:]))
    byid={h['id']:(i,h['score']) for i,h in enumerate(reference)}; pos={h['id']:i for i,h in enumerate(actual)}
    errors=[abs(h['score']-byid[h['id']][1]) for h in actual]
    bit=[0]*(n+1); meaningfulbit=[0]*(n+1); maximum=[-math.inf]*(n+1)
    def add(tree,index,value,maximum_mode=False):
        while index<=n:
            tree[index]=max(tree[index],value) if maximum_mode else tree[index]+value;index+=index&-index
    def query(tree,index,maximum_mode=False):
        result=-math.inf if maximum_mode else 0
        while index:
            result=max(result,tree[index]) if maximum_mode else result+tree[index];index-=index&-index
        return result
    inversions=meaningful=0;gap=0;cursor=0
    for i,h in enumerate(reference):
        reverse=n-pos[h['id']]
        inverted=query(bit,reverse-1);inversions+=inverted
        if inverted: gap=max(gap,query(maximum,reverse-1,True)-h['score'])
        while cursor<i and reference[cursor]['score']-h['score']>1e-6:
            add(meaningfulbit,n-pos[reference[cursor]['id']],1);cursor+=1
        meaningful+=query(meaningfulbit,reverse-1)
        add(bit,reverse,1);add(maximum,reverse,h['score'],True)
    return dict(count=n,identicalIds=ids==aids,identicalScores=all(h['score']==byid[h['id']][1] for h in actual),
      maximumScoreError=max(errors,default=0),meanScoreError=sum(errors)/max(1,n),top20Overlap=len(set(ids[:20])&set(aids[:20])),
      maxRankChange=max((abs(i-byid[h['id']][0]) for i,h in enumerate(actual)),default=0),inversions=inversions,
      meaningfulInversions=meaningful,meaningfulGapThreshold=1e-6,largestInversionScoreGap=gap)
def check_reported(expected,row):
    for name,value in expected.items():
        if isinstance(value,float):same_number(value,row[name])
        else: assert value==row[name],(name,value,row[name])
def source(root,result):
    archived=load(root/'source-snapshot.json')
    actual=hashlib.sha256(json.dumps(archived,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    assert actual==result['sourceSnapshotHash'],(actual,result['sourceSnapshotHash'])
    for role,before in result['before'].items():assert before['generation']==result['after'][role]['generation']
    return actual
def precision(root,result):
    saved={(key(row),row['method']):row for row in result['rows']}
    oracles={key(row):{doc['id']:doc for doc in row['documents']} for row in lines(root/'oracles.jsonl')}
    baselinechecks={key(row):row for row in result['baselineChecks']}
    totals=collections.defaultdict(lambda:dict(comparisons=0,documents=0,identicalOrders=0,minimumTop20=20,maximumScoreError=0,maximumOracleError=0,maximumInvertedScoreGap=0,maximumRankChange=0,meaningfulInversions=0))
    combinations=0;checked=set();corpus=None
    for raw in lines(root/'rankings.jsonl'):
        k=key(raw); assert k not in checked;checked.add(k);combinations+=1
        baseline=raw['rankings']['baseline']; ids={h['id'] for h in baseline};assert len(ids)==545
        if corpus is None:corpus=ids
        assert ids==corpus==set(oracles[k]); native=max(abs(h['score']-oracles[k][h['id']]['native']) for h in baseline)
        same_number(native,baselinechecks[k]['maximumNativeOracleError']);assert native<=2e-7
        for method,actual in raw['rankings'].items():
            if method=='baseline':continue
            row=saved[(k,method)]; comparison=ranks(baseline,actual);check_reported(comparison,row)
            oracle=max(abs(h['score']-oracles[k][h['id']]['scores'][method]) for h in actual)
            same_number(oracle,row['maximumOracleError']);encoding=method.rsplit('-',1)[-1];bounds=result['bounds'][encoding]
            target=max(doc['maximumTargetErrors'][encoding] for doc in oracles[k].values())
            same_number(target,row['maximumTargetQuantizationError']);assert target<=bounds['targetQuantization']+2e-16
            assert oracle<=bounds['serviceOracle'] and comparison['maximumScoreError']<=bounds['originalScore']
            out=totals[method];out['comparisons']+=1;out['documents']+=len(actual);out['identicalOrders']+=comparison['identicalIds']
            out['minimumTop20']=min(out['minimumTop20'],comparison['top20Overlap']);out['maximumOracleError']=max(out['maximumOracleError'],oracle)
            for name in ['maximumScoreError','maximumRankChange']:
                value=comparison['maxRankChange' if name=='maximumRankChange' else name];out[name]=max(out[name],value)
            out['maximumInvertedScoreGap']=max(out['maximumInvertedScoreGap'],comparison['largestInversionScoreGap']);out['meaningfulInversions']+=comparison['meaningfulInversions']
    assert combinations==result['expectedQueryPresetCombinations']==len(oracles)==len(baselinechecks)
    assert sum(row['comparisons'] for row in totals.values())==len(result['rows'])
    return dict(queryPresetCombinations=combinations,methods=dict(totals),documentScores=sum(row['documents'] for row in totals.values()))
def execution(root,result):
    references={key(row):row for row in lines(root/'references.jsonl')}
    saved={(key(row),row['method'],row['limit']):row for row in result['rows']}
    executions={(key(row),row['method'],row['limit']):row for row in lines(root/'executions.jsonl')}
    numeric_checks={key(row):row for row in result['numericChecks']};native_comparisons={key(row):row for row in result['nativeComparisons']}
    for k,ref in references.items():
        numeric=ref['numeric']['hits'];native=ref['native']['hits'];check=numeric_checks[k]
        error=max((abs(h['score']-ref['oracles'][h['id']]) for h in numeric),default=0)
        same_number(error,check['maximumOracleError']);assert check['oraclePassed']==(error<=2e-7)
        if not check['duplicateDiagnostic']:assert error<=2e-7
        check_reported(ranks(native,numeric),native_comparisons[k])
        if check['completeCorpus']:assert len(numeric)==545
    methods=collections.defaultdict(lambda:dict(executions=0,documents=0,identicalOrders=0,float32ScoresIdentical=0,exactTransportScores=0,positiveBounds=0,actuallyPruned=0,maximumPruned=0,maximumTransportDelta=0))
    checked=set()
    for trace in lines(root/'service-traces.jsonl'):
        identity=(key(trace),trace['method'],trace['limit']);assert identity not in checked;checked.add(identity)
        actual=trace['result']['hits'];expected=references[identity[0]]['numeric']['hits'][:trace['limit']]
        assert [h['id'] for h in expected]==[h['id'] for h in actual]
        assert all(f32(a['score'])==f32(b['score']) for a,b in zip(actual,expected))
        if trace['method']!='favorite-utility-sorted':assert actual==expected
        row=saved[identity];assert executions[identity]['result']==trace['result']
        delta=max((abs(a['score']-b['score']) for a,b in zip(actual,expected)),default=0);same_number(delta,row['maximumTransportDelta'])
        out=methods[trace['method']];out['executions']+=1;out['documents']+=len(actual);out['identicalOrders']+=1;out['float32ScoresIdentical']+=1
        out['exactTransportScores']+=actual==expected;out['maximumTransportDelta']=max(out['maximumTransportDelta'],delta)
        if trace['method']=='favorite-utility-bounded':
            searches=[t for t in trace['trace'] if '_search?' in t['route']]
            opened=[t['response']['body']['pit_id'] for t in trace['trace'] if t['request']['method']=='POST' and 'point_in_time' in t['route']]
            closed=[pit for t in trace['trace'] if t['request']['method']=='DELETE' and 'point_in_time' in t['route'] for pit in t['request']['body']['pit_id']]
            assert len(opened)==1 and opened[0] in closed
            current_pit=opened[0];seen_pits={current_pit}
            for call in searches:
                assert call['request']['body']['pit']['id']==current_pit
                current_pit=call['response']['body'].get('pit_id',current_pit);seen_pits.add(current_pit)
            assert seen_pits.issubset(set(closed))
            final=searches[-1];ids=[(h['fields']['id'][0] if h.get('fields',{}).get('id') else h['_id']) for h in final['response']['body']['hits']['hits']]
            assert ids==[h['id'] for h in actual]
            baseline=references[identity[0]]['numericBody'];body=final['request']['body'];bound=row['bounds']
            assert body['query']['bool']['should']==baseline['query']['bool']['should']
            filters=baseline['query']['bool']['filter'];assert body['query']['bool']['filter'][:len(filters)]==filters
            extra=body['query']['bool']['filter'][len(filters):]
            assert bound['completeCandidateCoverage'] and bound['consistency']=='point-in-time'
            if bound['positiveThresholdApplied']:
                out['positiveBounds']+=1;assert len(extra)==1 and extra[0]['bool']['minimum_should_match']==1
                assert all(next(iter(c['range'].values()))['gte']==bound['threshold'] for c in extra[0]['bool']['should'])
                assert len(actual)<=bound['boundEligibleCount']<=bound['totalEligibleCount']
                assert bound['prunedCount']==bound['totalEligibleCount']-bound['boundEligibleCount']
                out['actuallyPruned']+=bound['prunedCount']>0;out['maximumPruned']=max(out['maximumPruned'],bound['prunedCount'])
            else:assert not extra
    assert len(checked)==len(saved)==len(executions)==result['expectedExecutions']
    assert sum(m['positiveBounds'] for m in methods.values())==result['positiveBoundExecutions']
    assert sum(m['actuallyPruned'] for m in methods.values())==result['actuallyPrunedExecutions']
    return dict(referenceQueries=len(references),executions=len(checked),methods=dict(methods),intendedArithmeticPassed=all(r['oraclePassed'] for r in result['numericChecks']),duplicateDiagnostics=result['duplicateDiagnostics'])
def main():
    parser=argparse.ArgumentParser();parser.add_argument('kind',choices=['precision','execution']);parser.add_argument('directory',type=pathlib.Path);parser.add_argument('--output',required=True,type=pathlib.Path);args=parser.parse_args()
    result=load(args.directory/'fidelity.json');assert result.get('finishedAt') and not result.get('error')
    source_hash=source(args.directory,result)
    audit=precision(args.directory,result) if args.kind=='precision' else execution(args.directory,result)
    receipt=dict(schemaVersion=1,kind=args.kind,directory=str(args.directory),auditedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),integrityPassed=True,experimentPassed=result.get('passed'),
      sourceSnapshotHash=source_hash,summaryHash=digest(args.directory/'fidelity.json'),auditCodeHash=digest(__file__),**audit,
      limitations=['Independent consistency audit of saved responses/oracles and source hashes; no service re-execution or new relevance labels.'])
    with args.output.open('x') as stream:json.dump(receipt,stream,indent=2)
    print(json.dumps(receipt))
if __name__=='__main__':main()
