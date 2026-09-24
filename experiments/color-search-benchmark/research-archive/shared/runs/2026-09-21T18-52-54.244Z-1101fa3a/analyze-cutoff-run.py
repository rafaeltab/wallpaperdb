import json, math, os, statistics, collections
from pathlib import Path
root=Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-21T18-52-54.244Z-1101fa3a')
run=json.loads((root/'run.json').read_text())
dataset=json.loads((root/'dataset.json').read_text())
caseinfo={case['id']:case for case in dataset['cases']}
precision={'precision-shade-001','precision-warm-red-batch-001','precision-muted-green-batch-001'}
named={'vibe-grayscale-001','vibe-dark-001','vibe-dark-batch-001','vibe-light-batch-001','vibe-vivid-batch-001','vibe-strict-grayscale-batch-001','vibe-near-neutral-batch-001','vibe-monochromatic-batch-001','palette-rainbow-batch-001'}
mixed={'composition-gray-red-batch-001','composition-gray-red-batch-002'}
def quantile(values,q):
    v=sorted(values);return v[max(0,math.ceil(len(v)*q)-1)] if v else None

def summarize(cases):
    valid=[case for case in cases if case['status']=='ok']
    values=[case['accuracy']['allPairs']['agreement'] for case in valid if case['accuracy']['allPairs']['agreement'] is not None]
    sensitive=[case['accuracy']['withoutUncertain']['agreement'] for case in valid if case['accuracy']['withoutUncertain']['agreement'] is not None]
    ties=sum(case['accuracy']['allPairs']['tied'] for case in valid)
    assessed=sum(case['accuracy']['allPairs']['assessedPairs'] for case in valid)
    samples=[sample for case in valid for sample in case['performance'].get('samplesMs',[])]
    return {'cases':len(valid),'queryMacroAgreement':statistics.mean(values) if values else None,'withoutUncertainMacro':statistics.mean(sensitive) if sensitive else None,'assessedPairs':assessed,'concordant':sum(case['accuracy']['allPairs']['concordant'] for case in valid),'discordant':sum(case['accuracy']['allPairs']['discordant'] for case in valid),'tied':ties,'tieFraction':ties/assessed if assessed else None,'timedSamples':len(samples),'p50Ms':quantile(samples,.5),'p95Ms':quantile(samples,.95),'maxMs':max(samples) if samples else None,'sumTimedMs':sum(samples)}

results=[]
for candidate in run['candidates']:
    p=candidate['configuration'].get('parameters',{})
    mode=p.get('namedMode') or ('concrete-swatches' if candidate['configuration']['method']=='overlap-quality-dense' else 'named-families')
    rows=candidate['cases']
    affected=lambda case: case['caseId'] in precision if mode=='named-families' else case['caseId'] not in named
    real=lambda case: caseinfo[case['caseId']]['inputKind']=='image'
    summaries={'all':summarize(rows),'affected':summarize([c for c in rows if affected(c)]),'real':summarize([c for c in rows if real(c)]),'affectedReal':summarize([c for c in rows if affected(c) and real(c)]),'precision':summarize([c for c in rows if c['caseId'] in precision]),'invariant':summarize([c for c in rows if not affected(c)])}
    compact=[]
    for case in rows:
        scores={hit['id']:hit['score'] for hit in case.get('hits',[])}
        expected=case['accuracy']['coverage']['expectedIds']
        compact.append({'id':case['caseId'],'status':case['status'],'reason':case.get('reason'),'inputKind':caseinfo[case['caseId']]['inputKind'],'groupId':case['groupId'],'affected':affected(case),'mixed':case['caseId'] in mixed,'allPairs':case['accuracy']['allPairs'],'withoutUncertain':case['accuracy']['withoutUncertain'],'p95Ms':case['performance']['p95Ms'],'samplesMs':case['performance'].get('samplesMs',[]),'judgedScores':{id:scores.get(id) for id in expected},'judgedZeros':sum(scores.get(id)==0 for id in expected),'top20Judged':sum(hit['id'] in expected for hit in case.get('hits',[])[:20]),'coverage':case['accuracy']['coverage']['fraction']})
    results.append({'id':candidate['id'],'method':candidate['configuration']['method'],'parameters':p,'mode':mode,'baseline':candidate['id'].startswith('baseline-'),'summary':candidate['summary'],'subsets':summaries,'cases':compact,'setup':{key:candidate['setup'].get(key) for key in ['elapsedMs','verificationReusedWithinRun','count','allValuesVerified','hard50ParityVerified','error','index']},'resources':candidate.get('resources',{})})
first=results[0]
output={'runId':run['id'],'createdAt':run['createdAt'],'dataset':run['dataset'],'workload':run['workload'],'rawRunBytes':(root/'run.json').stat().st_size,'rawRunModifiedAtEpoch':(root/'run.json').stat().st_mtime,'candidates':results}
(root/'cutoff-analysis.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps({'topKeys':list(run),'candidateKeys':list(run['candidates'][0]),'firstSummary':first['summary'],'firstSetup':first['setup'],'firstResources':first['resources'],'candidateCount':len(results),'analysis':str(root/'cutoff-analysis.json'),'compactBytes':(root/'cutoff-analysis.json').stat().st_size},indent=2))
