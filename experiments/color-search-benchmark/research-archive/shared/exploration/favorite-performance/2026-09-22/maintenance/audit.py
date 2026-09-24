"""Bounded filesystem-only maintenance receipt audit. Run outside timed blocks."""
import json,hashlib,datetime
from pathlib import Path
D=Path(__file__).resolve().parent;P=D.parent
ROOT=Path('/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark')
errors=[];checks=0

def ck(ok,msg):
 global checks
 checks+=1
 if not ok:errors.append(msg)
def sha(b):return hashlib.sha256(b).hexdigest()
def js(x,sort=False):return json.dumps(x,ensure_ascii=False,separators=(',',':'),sort_keys=sort).encode()
def filehash(p):
 h=hashlib.sha256()
 with Path(p).open('rb')as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def segments(s,index):
 body=s['segments']['body'];out={}
 ck(body['_shards']['failed']==0,'segments no failed shards')
 for shard,replicas in body['indices'][index]['shards'].items():
  ck(len(replicas)==1,'single shard replica entry')
  x=replicas[0];ck(x['routing']['primary']and x['routing']['state']=='STARTED','started primary')
  ck(x['num_search_segments']==sum(v['search']for v in x['segments'].values()),'search segment count')
  ck(x['num_committed_segments']==sum(v['committed']for v in x['segments'].values()),'committed segment count')
  for name,value in x['segments'].items():out[shard+':'+name]=value
 return out
b=(D/'maintenance.json').read_bytes();r=json.loads(b);plan=json.loads((D/'plan.json').read_text())
ck(r['experiment']=='strict-hue-favorite-maintenance'and r['schemaVersion']==1,'experiment')
ck(r.get('finishedAt')and r['preconditionsVerified']and not r.get('interruption'),'completed')
ck(r['base']=='http://127.0.0.1:19217','isolated service')
ck(sha(js(plan))==r['planHash'],'plan hash')
ck(all(r[k]==v for k,v in plan.items()),'plan preserved')
src=json.loads((D/'source-snapshot.json').read_text());ck(sha(js(src))==r['sourceSnapshotHash'],'source snapshot hash')
for f,s in src.items():ck((ROOT/f).read_text()==s,'current source unchanged '+f)
ck([i['phase']for i in r['indices']]==['projection','full256','full1024'],'all three phases')
expected={'projection':(1000000,76,'a55de34251457f0f3e7c497206a63f529bc5c0195d9560facaf63ab17ad4e833'),'full256':(100000,2612,'ba80798a7c20d88ee3225dfd14434334dcce25cf20289f093ce09900700ddc33'),'full1024':(100000,10292,'146ff291ba67dbdf4425f9f85da3b639b0bda530d3a257f366c6e97a96187816')}
summary=[];allpre=[]
for entry in r['indices']:
 phase=entry['phase'];index=entry['index'];count,fields,parenthash=expected[phase]
 ck(entry['status']=='complete'and entry['completedAt']<=r['finishedAt'],'completed '+phase)
 ck(entry['count']==count and sha(js(entry['identity']))==entry['identityHash'],'identity '+phase)
 ck(entry['identity']['source']['snapshotId']=='strict-hue-favorite-001'and entry['identity']['source']['snapshotManifestHash']=='0c73fec9b5c8f3844c23b5d2e3b06738852ea32b8f333896b6bb4fd3c89ca7ad','saved snapshot '+phase)
 ck(entry['expectedMappingHash']==entry['identity']['mappingHash'],'frozen schema hash '+phase)
 ck(entry['campaignSha256']==parenthash==filehash(entry['campaignFile']),'audited parent bytes '+phase)
 arch=json.loads((Path(entry['campaignFile']).parent/'source-snapshot.json').read_text())
 ck(sha(js(arch))==entry['sourceSnapshotHash']=='2e971e1535072d75496e1354f55f932c746b2242a554ac02151b84f1bd2c6461','frozen primary source '+phase)
 ck({f:sha(s.encode())for f,s in arch.items()}==entry['identity']['sourceHashes'],'frozen source identity '+phase)
 for f,s in arch.items():ck((ROOT/f).read_text()==s,'primary source still unchanged '+f)
 maps=[];settings=[]
 for name in ['preflight','before','after']:
  state=entry[name];m=state['mapping']['body'][index]['mappings'];sett=state['settings']['body'][index]['settings']['index'];maps.append(m);settings.append(sett)
  ck(state['count']['body']['count']==count==state['stats']['body']['_all']['primaries']['docs']['count'],'state count '+phase+'/'+name)
  ck(sett['uuid']==entry['uuid']and sett['number_of_shards']=='1'and sett['number_of_replicas']=='0','state identity '+phase+'/'+name)
  ck(m['_meta']['identityHash']==entry['identityHash']and m['_meta']['identity']==entry['identity'],'state metadata '+phase+'/'+name)
  ck(m['dynamic']=='strict'and len(m['properties'])==fields,'state schema '+phase+'/'+name)
  ck(m.get('_source',{}).get('enabled',True)==(phase!='projection'),'source layout '+phase+'/'+name)
  for route in ['mapping','settings','count','stats','segments']:
   x=state[route];ck(x['method']=='GET'and x['route'].startswith(index+'/')and x['startedAt']<=x['finishedAt'],'read-only capture '+phase+'/'+name+'/'+route)
   if name=='preflight':allpre.append(x['finishedAt'])
 ck(maps[0]==maps[1]==maps[2]and settings[0]==settings[1]==settings[2],'exact mapping/settings stable '+phase)
 ck(sha(js(maps[2],True))==entry['mappingHash'],'observed mapping hash '+phase)
 for kind,suffix in [('flush','/_flush?wait_if_ongoing=true'),('refresh','/_refresh')]:
  x=entry[kind];ck(x['method']=='POST'and x['route']==index+suffix,'only normal operation '+phase+'/'+kind)
  ck(x['body']['_shards']=={'total':1,'successful':1,'failed':0},'operation success '+phase+'/'+kind)
 ck(max(entry['before'][key]['finishedAt']for key in ['mapping','settings','count','stats','segments'])<=entry['flush']['startedAt']<=entry['flush']['finishedAt']<=entry['refresh']['startedAt']<=entry['refresh']['finishedAt'],'operation chronology '+phase)
 settle=entry['settling'];ck(settle['settled']and settle['quietSamples']>=2,'settled '+phase)
 for x in settle['samples'][-settle['quietSamples']:]:ck(all(x[k]==0 for k in ['active','queued','queryCurrent','fetchCurrent','merges'])and entry['refresh']['finishedAt']<=x['at']<=entry['after']['capturedAt'],'quiet after refresh '+phase)
 if phase=='full1024':
  cr=entry['completionRecord'];ck(cr['sha256']==filehash(cr['path'])=='7f1950e8f1c79ee3649caca9b50e0b8b5382f2db8b31102b2d5d6d7f9bc09bae','audited separate completion unchanged')
  ev=entry['completionEvidence'];ck(ev['kind']=='separate-read-only-completion'and len(ev['parentHistory']['interruptions'])==2 and len(ev['completedCaseIds'])==12,'preserved incomplete-parent lineage')
 before=segments(entry['before'],index);after=segments(entry['after'],index)
 searchableBefore={k:v for k,v in before.items()if v['search']};searchableAfter={k:v for k,v in after.items()if v['search']}
 ck(sum(x['num_docs']for x in searchableBefore.values())==count==sum(x['num_docs']for x in searchableAfter.values()),'all live documents represented '+phase)
 bstat=entry['before']['stats']['body']['_all']['primaries'];astat=entry['after']['stats']['body']['_all']['primaries']
 summary.append({'phase':phase,'index':index,'uuid':entry['uuid'],'documents':count,'mappedFields':fields,'beforeStoreBytes':bstat['store']['size_in_bytes'],'afterStoreBytes':astat['store']['size_in_bytes'],'beforeStatsSegments':bstat['segments']['count'],'afterStatsSegments':astat['segments']['count'],'beforeSearchSegments':len(searchableBefore),'afterSearchSegments':len(searchableAfter),'exactAllSegmentEntriesUnchanged':before==after,'exactSearchSegmentEntriesUnchanged':searchableBefore==searchableAfter,'searchSegmentHashBefore':sha(js(searchableBefore,True)),'searchSegmentHashAfter':sha(js(searchableAfter,True)),'searchSegmentsRemoved':sorted(set(searchableBefore)-set(searchableAfter)),'searchSegmentsAdded':sorted(set(searchableAfter)-set(searchableBefore)),'retainedSearchSegmentsChanged':[k for k in sorted(set(searchableBefore)&set(searchableAfter))if searchableBefore[k]!=searchableAfter[k]],'searchSegmentNamesBefore':sorted(searchableBefore),'searchSegmentNamesAfter':sorted(searchableAfter)})
ck(max(allpre)<=r['preconditionsVerifiedAt']<=min(i['flush']['startedAt']for i in r['indices']),'all three preflights before first mutation')
result={'passed':not errors,'checks':checks,'errors':errors,'auditedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'receiptSha256':sha(b),'planHash':r['planHash'],'sourceSnapshotHash':r['sourceSnapshotHash'],'indices':summary,'interpretation':'Original measured artifacts remain unchanged. The following maintained timing is a repeat with newly built full indexes/cache context; unchanged projection segments do not support attribution to projection compaction.'}
(D/'audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if errors:raise SystemExit(1)
