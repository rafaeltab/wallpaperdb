import json,statistics,datetime,math
from pathlib import Path
root=Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-21T18-52-54.244Z-1101fa3a')
p=root/'cutoff-analysis.json';data=json.loads(p.read_text())
byid={c['id']:c for c in data['candidates']}
casebyid={id:{c['id']:c for c in record['cases']} for id,record in byid.items()}
candidate=case=None
counts={'httpMs':0,'serviceTookMs':0}
with (root/'run.json').open() as f:
 for line in f:
  if line.startswith('      "id":'):
   candidate=json.loads(line.strip().split(': ',1)[1].rstrip(','));case=None
  elif candidate in byid and line.startswith('          "caseId":'):
   case=json.loads(line.strip().split(': ',1)[1].rstrip(','))
  elif candidate in byid and case in casebyid[candidate] and line.startswith('              "'):
   stripped=line.strip()
   for key in counts:
    if stripped.startswith('"'+key+'":'):
     value=json.loads(stripped.split(': ',1)[1].rstrip(','));casebyid[candidate][case].setdefault('accuracyEvidence',{})[key]=value;counts[key]+=1
assert counts=={'httpMs':5208,'serviceTookMs':5208},counts
allhttp=[];alltook=[];groups=[]
for candidate in data['candidates']:
 http=[c['accuracyEvidence']['httpMs'] for c in candidate['cases'] if c.get('accuracyEvidence')]
 took=[c['accuracyEvidence']['serviceTookMs'] for c in candidate['cases'] if c.get('accuracyEvidence')]
 allhttp+=http;alltook+=took
 record={'count':len(http),'sumHttpMs':sum(http),'sumServiceTookMs':sum(took),'medianHttpMs':statistics.median(http),'p95HttpMs':sorted(http)[math.ceil(.95*len(http))-1],'maxHttpMs':max(http)}
 candidate['fullAccuracyRetrieval']=record
 groups.append({'id':candidate['id'],**record})
start=datetime.datetime.fromisoformat(data['createdAt'].replace('Z','+00:00')).timestamp()
wall=(data['rawRunModifiedAtEpoch']-start)*1000
accounted=sum(allhttp)+data['findings']['setupSumMs']+data['findings']['measurementBlockSumMs']
summary={'capturedRequests':len(allhttp),'sumHttpMs':sum(allhttp),'sumServiceTookMs':sum(alltook),'medianHttpMs':statistics.median(allhttp),'p95HttpMs':sorted(allhttp)[math.ceil(.95*len(allhttp))-1],'maxHttpMs':max(allhttp),'sumHttpMinusServiceTookMs':sum(allhttp)-sum(alltook),'wallUntilRawFileWrittenMs':wall,'accountedSetupAccuracyAndMeasurementBlockMs':accounted,'unattributedWallMs':wall-accounted,'largestAccuracyTotals':sorted(groups,key=lambda g:g['sumHttpMs'],reverse=True)[:8],'byCount':{}}
for count in [16,64,256,1024]:
 matches=[c for c in data['candidates'] if not c['baseline'] and c['parameters']['bucketCount']==count]
 summary['byCount'][count]={'candidates':len(matches),'accuracyHttpTotalMs':sum(c['fullAccuracyRetrieval']['sumHttpMs'] for c in matches),'accuracyServiceTookTotalMs':sum(c['fullAccuracyRetrieval']['sumServiceTookMs'] for c in matches),'accuracyMaxHttpMs':max(c['fullAccuracyRetrieval']['maxHttpMs'] for c in matches)}
data['findings']['fullAccuracyRetrieval']=summary
p.write_text(json.dumps(data,separators=(',',':'))+'\n');(root/'cutoff-findings.json').write_text(json.dumps(data['findings'],indent=2)+'\n')
(root/'cutoff-timing-attribution.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
