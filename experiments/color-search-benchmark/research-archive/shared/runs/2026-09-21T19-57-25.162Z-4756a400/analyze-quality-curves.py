import json, math, statistics, collections, time
from pathlib import Path
started=time.monotonic()
root=Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-21T19-57-25.162Z-4756a400')
run=json.loads((root/'run.json').read_text())
dataset=json.loads((root/'dataset.json').read_text())
caseinfo={c['id']:c for c in dataset['cases']}
def mode(c):
 q=caseinfo[c['caseId']]['query']
 return ('proportions' if '%' in q else 'vibe') if isinstance(q,str) else q.get('mode') or ('proportions' if q.get('specifiedPercentages') or q.get('colorTargets') else 'vibe')
def quantile(values,q):
 v=sorted(values);return v[max(0,math.ceil(len(v)*q)-1)] if v else None
def summarize(cases):
 valid=[c for c in cases if c['status']=='ok']
 values=[c['accuracy']['allPairs']['agreement'] for c in valid if c['accuracy']['allPairs']['agreement'] is not None]
 sens=[c['accuracy']['withoutUncertain']['agreement'] for c in valid if c['accuracy']['withoutUncertain']['agreement'] is not None]
 ties=sum(c['accuracy']['allPairs']['tied'] for c in valid)
 assessed=sum(c['accuracy']['allPairs']['assessedPairs'] for c in valid)
 samples=[s for c in valid for s in c['performance'].get('samplesMs',[])]
 counts=collections.Counter()
 for c in valid:
  scores={h['id']:h['score'] for h in c.get('hits',[])}
  judged=[scores[k] for k in c['accuracy']['coverage']['expectedIds'] if k in scores]
  counts['judgedScoreObservations']+=len(judged)
  counts['judgedZeroScores']+=sum(s==0 for s in judged)
  counts['allJudgedZeroCases']+=bool(judged) and all(s==0 for s in judged)
  counts['retrievedScoreObservations']+=len(scores)
  counts['retrievedZeroScores']+=sum(s==0 for s in scores.values())
  counts['allRetrievedZeroCases']+=bool(scores) and all(s==0 for s in scores.values())
  counts['top20ScoreObservations']+=min(20,len(scores))
  counts['top20ZeroScores']+=sum(h['score']==0 for h in c.get('hits',[])[:20])
 return {'cases':len(valid),'queryMacroAgreement':statistics.mean(values) if values else None,'withoutUncertainMacro':statistics.mean(sens) if sens else None,'assessedPairs':assessed,'concordant':sum(c['accuracy']['allPairs']['concordant'] for c in valid),'discordant':sum(c['accuracy']['allPairs']['discordant'] for c in valid),'tied':ties,'tieFraction':ties/assessed if assessed else None,**dict(counts),'timedSamples':len(samples),'p50Ms':quantile(samples,.5),'p95Ms':quantile(samples,.95),'maxMs':max(samples) if samples else None,'timedAtOrAbove1s':sum(s>=1000 for s in samples),'sumTimedMs':sum(samples),'eligibilityViolations':sum(c['accuracy']['eligibility']['violations'] for c in valid),'missingJudgedEndpoints':sum(len(c['accuracy']['coverage']['missingIds']) for c in valid)}
results=[]
for c in run['candidates']:
 p=c['configuration'].get('parameters',{});rows=c['cases']
 real=lambda r:caseinfo[r['caseId']]['inputKind']=='image'
 subsets={'all':summarize(rows),'real':summarize([r for r in rows if real(r)]),'vibe':summarize([r for r in rows if mode(r)=='vibe']),'proportions':summarize([r for r in rows if mode(r)=='proportions']),'realVibe':summarize([r for r in rows if real(r) and mode(r)=='vibe']),'realProportions':summarize([r for r in rows if real(r) and mode(r)=='proportions'])}
 compact=[]
 for r in rows:
  scores={h['id']:h['score'] for h in r.get('hits',[])};expected=r['accuracy']['coverage']['expectedIds']
  compact.append({'id':r['caseId'],'status':r['status'],'reason':r.get('reason'),'inputKind':caseinfo[r['caseId']]['inputKind'],'mode':mode(r),'groupId':r['groupId'],'allPairs':r['accuracy']['allPairs'],'withoutUncertain':r['accuracy']['withoutUncertain'],'judgedScores':{i:scores.get(i) for i in expected},'coverage':r['accuracy']['coverage']['fraction'],'retrievedCount':len(scores),'retrievedZeroScores':sum(s==0 for s in scores.values()),'top20ZeroScores':sum(h['score']==0 for h in r.get('hits',[])[:20]),'performance':r['performance']})
 results.append({'id':c['id'],'method':c['configuration']['method'],'parameters':p,'statusCounts':dict(collections.Counter(r['status'] for r in rows)),'summary':c['summary'],'subsets':subsets,'cases':compact,'setup':c['setup']})
bykey={}
for c in results:
 p=c['parameters'];key=(c['method'],json.dumps({k:v for k,v in p.items() if k!='qualityCurve'},sort_keys=True))
 bykey.setdefault(key,{})[p.get('qualityCurve','linear')]=c
pairs=[]
for key,curves in bykey.items():
 assert set(curves)=={'linear','power'},(key,list(curves))
 a,b=curves['linear'],curves['power'];assert a['parameters']['qualityInfluence']==3
 subset_deltas={}
 for subset in a['subsets']:
  x,y=a['subsets'][subset],b['subsets'][subset]
  subset_deltas[subset]={'linear':x,'power':y,'agreementDelta':y['queryMacroAgreement']-x['queryMacroAgreement'],'withoutUncertainDelta':y['withoutUncertainMacro']-x['withoutUncertainMacro'],'tieDelta':y['tied']-x['tied'],'judgedZerosDelta':y['judgedZeroScores']-x['judgedZeroScores']}
 case_deltas=[]
 for x,y in zip(a['cases'],b['cases']):
  assert x['id']==y['id'] and x['status']==y['status']
  if x['status']!='ok':continue
  delta=y['allPairs']['agreement']-x['allPairs']['agreement']
  if delta:case_deltas.append({'id':x['id'],'inputKind':x['inputKind'],'mode':x['mode'],'linear':x['allPairs']['agreement'],'power':y['allPairs']['agreement'],'delta':delta,'linearTies':x['allPairs']['tied'],'powerTies':y['allPairs']['tied']})
 pairs.append({'method':a['method'],'parameters':{k:v for k,v in a['parameters'].items() if k!='qualityCurve'},'linearId':a['id'],'powerId':b['id'],'subsets':subset_deltas,'caseDeltas':case_deltas,'improvedCases':sum(x['delta']>0 for x in case_deltas),'regressedCases':sum(x['delta']<0 for x in case_deltas)})
output={'runId':run['id'],'createdAt':run['createdAt'],'dataset':run['dataset'],'workload':run['workload'],'candidateCount':len(results),'matchedPairs':len(pairs),'metricPolicy':'strict-pair-query-macro-v1; exact model ties half credit; unsupported excluded from agreement but counted in coverage','candidates':results,'pairs':pairs}
(root/'quality-curve-analysis.json').write_text(json.dumps(output,indent=2)+'\n')
summary={'runId':run['id'],'candidateCount':len(results),'matchedPairs':len(pairs),'statusCounts':dict(collections.Counter(json.dumps(c['statusCounts'],sort_keys=True) for c in results)),'timedRequests':sum(c['subsets']['all']['timedSamples'] for c in results),'timedAtOrAbove1s':sum(c['subsets']['all']['timedAtOrAbove1s'] for c in results),'candidateP95Range':[min(c['subsets']['all']['p95Ms'] for c in results),max(c['subsets']['all']['p95Ms'] for c in results)],'maxTimedMs':max(c['subsets']['all']['maxMs'] for c in results),'pairedRows':[{'method':p['method'],'bucketCount':p['parameters']['bucketCount'],'pixelCutoff':p['parameters'].get('pixelCutoff'),'allLinear':p['subsets']['all']['linear']['queryMacroAgreement'],'allPower':p['subsets']['all']['power']['queryMacroAgreement'],'realLinear':p['subsets']['real']['linear']['queryMacroAgreement'],'realPower':p['subsets']['real']['power']['queryMacroAgreement'],'vibeDelta':p['subsets']['vibe']['agreementDelta'],'proportionsDelta':p['subsets']['proportions']['agreementDelta'],'judgedZerosLinear':p['subsets']['all']['linear']['judgedZeroScores'],'judgedZerosPower':p['subsets']['all']['power']['judgedZeroScores'],'tiesLinear':p['subsets']['all']['linear']['tied'],'tiesPower':p['subsets']['all']['power']['tied'],'improvedCases':p['improvedCases'],'regressedCases':p['regressedCases']} for p in pairs],'analysisPath':str(root/'quality-curve-analysis.json'),'analysisSeconds':time.monotonic()-started}
(root/'quality-curve-findings.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
