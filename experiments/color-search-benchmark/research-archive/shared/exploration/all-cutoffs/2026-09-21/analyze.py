import json
import math
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
data = json.loads(source.read_text())
candidates = data['candidates']
assert len(candidates) == 49
assert len({c['id'] for c in candidates}) == 49
assert data['dataset']['corpusSize'] == 545

def mean(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None

def metrics(cases):
    return {
        'cases': len(cases),
        'agreement': mean([c['accuracy']['allPairs']['agreement'] for c in cases]),
        'withoutUncertain': mean([c['accuracy']['withoutUncertain']['agreement'] for c in cases]),
        'pairs': sum(c['accuracy']['allPairs']['assessedPairs'] for c in cases),
        'ties': sum(c['accuracy']['allPairs']['tied'] for c in cases),
        'missingImages': sum(len(c['accuracy']['coverage']['missingIds']) for c in cases),
        'eligibilityViolations': sum(c['accuracy']['eligibility']['violations'] for c in cases),
        'judgedZeros': sum(c['judgedZeros'] for c in cases),
        'firstTimedTop20Zeros': sum(c['firstTimedTop20Zeros'] for c in cases),
    }

def is_proportion(case):
    query = case['query']
    return query.get('specifiedPercentages') is not None or bool(query.get('colorTargets'))

rows = []
for candidate in candidates:
    cases = [c for c in candidate['cases'] if c['status'] == 'ok']
    real = [c for c in cases if c['inputKind'] == 'image']
    row = {
        'id': candidate['id'],
        'method': candidate['configuration']['method'],
        'parameters': candidate['configuration'].get('parameters', {}),
        'coverage': candidate['coverage'],
        'all': metrics(cases),
        'real': metrics(real),
        'vibe': metrics([c for c in cases if not is_proportion(c)]),
        'proportions': metrics([c for c in cases if is_proportion(c)]),
        'performance': candidate['performance'],
        'timedAtOrAbove1s': candidate['timedAtOrAbove1s'],
        'caseScores': {c['caseId']: c['accuracy']['allPairs']['agreement'] for c in cases},
    }
    assert row['coverage'] == {'total':37,'ok':31,'unsupported':6,'error':0}, row['id']
    assert row['real']['cases'] == 27 and row['real']['pairs'] == 183, row['id']
    assert row['vibe']['cases'] == 19 and row['proportions']['cases'] == 12, row['id']
    assert row['all']['missingImages'] == 0 and row['all']['eligibilityViolations'] == 0, row['id']
    assert row['performance']['sampleCount'] == 93 and row['performance']['failures'] == 0, row['id']
    assert abs(row['all']['agreement'] - candidate['accuracy']['allPairs']['queryMacroAgreement']) < 1e-12
    rows.append(row)

by_id = {r['id']:r for r in rows}
def comparison(a,b):
    changes = {key:a['caseScores'][key]-b['caseScores'][key] for key in a['caseScores']}
    return {
        'candidate':a['id'], 'baseline':b['id'],
        'allDelta':a['all']['agreement']-b['all']['agreement'],
        'realDelta':a['real']['agreement']-b['real']['agreement'],
        'realWithoutUncertainDelta':a['real']['withoutUncertain']-b['real']['withoutUncertain'],
        'vibeDelta':a['vibe']['agreement']-b['vibe']['agreement'],
        'proportionsDelta':a['proportions']['agreement']-b['proportions']['agreement'],
        'improvedCases':sum(v>1e-12 for v in changes.values()),
        'regressedCases':sum(v< -1e-12 for v in changes.values()),
        'changedCases':{key:value for key,value in changes.items() if abs(value)>1e-12},
    }

comparisons = []
for row in rows:
    if row['method'] != 'cutoff-all-levels' or row['id'] == 'cutoff-all-levels':
        continue
    p = row['parameters']
    bank,influence,blend = p['bucketCount'],p['qualityInfluence'],p['cutoffBlendExponent']
    baseline_ids = [f'cutoff-consensus-{bank}-q00-i{influence}', f'cutoff-consensus-{bank}-q50-i{influence}']
    if blend != 0:
        baseline_ids.insert(0, f'cutoff-all-levels-{bank}-blend0-i{influence}')
    comparisons += [comparison(row,by_id[baseline]) for baseline in baseline_ids]

findings = {
    'runId':data['runId'], 'candidateCount':len(rows),
    'corpusSize':data['dataset']['corpusSize'],
    'newParameterCandidates':sum(r['method']=='cutoff-all-levels' and r['id']!='cutoff-all-levels' for r in rows),
    'registeredDefaults':sum(r['id']=='cutoff-all-levels' for r in rows),
    'controls':sum(r['method']=='cutoff-consensus' for r in rows),
    'coveragePerCandidate':rows[0]['coverage'],
    'timedRequests':sum(r['performance']['sampleCount'] for r in rows),
    'timedAtOrAbove1s':sum(r['timedAtOrAbove1s'] for r in rows),
    'failures':sum(r['performance']['failures'] for r in rows),
    'candidateP95Range':[min(r['performance']['p95Ms'] for r in rows),max(r['performance']['p95Ms'] for r in rows)],
    'maxTimedMs':max(r['performance']['maxMs'] for r in rows),
    'rows':rows, 'comparisons':comparisons,
    'limitations':[
        'Single reviewer development preferences; related cases and repeated images are not independent samples.',
        'No held-out accuracy study or production winner. Archive wallpapers are unjudged.',
        'Timing is sequential candidates, warmup 1, repeats 3, concurrency 1 on 545 assets; not a million-document capacity test.',
        'Existing five-color consensus scale failures are unchanged and are not superseded by small-corpus timings.',
    ],
}
output = source.with_name('all-cutoff-findings.json')
output.write_text(json.dumps(findings,indent=2)+'\n')
print(json.dumps({k:v for k,v in findings.items() if k not in ('rows','comparisons')},indent=2))
print('ROWS')
for row in rows:
    print(row['id'], 'all',round(100*row['all']['agreement'],2),'real',round(100*row['real']['agreement'],2),'p95',round(row['performance']['p95Ms'],3))
print('BLEND 6 VS 0')
for cmp in comparisons:
    if '-blend6-' in cmp['candidate'] and '-blend0-' in cmp['baseline']:
        print(json.dumps({k:v for k,v in cmp.items() if k!='changedCases'}))
