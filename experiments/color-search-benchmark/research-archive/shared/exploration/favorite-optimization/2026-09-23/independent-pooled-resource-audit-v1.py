#!/usr/bin/env python3
"""Independent focused replay of saved resource counters, no helper imports/services."""
import json,gzip,hashlib,datetime,math,pathlib,collections
R=pathlib.Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23')
D=R/'resources-full-million-pooled-completed-v1'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while chunk:=f.read(1048576):h.update(chunk)
 return h.hexdigest()
def date(value):return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
def kv(value):return {p[0]:int(p[1]) for line in value.splitlines() if len(p:=line.split())==2}
def psi(value):return {parts[0]:{k:float(v) for k,v in [item.split('=') for item in parts[1:]]} for line in value.splitlines() if (parts:=line.split())}
def io(value):return {parts[0]:{k:int(v) for k,v in [item.split('=') for item in parts[1:]]} for line in value.splitlines() if (parts:=line.split())}
def gauge(values):return {'first':values[0],'last':values[-1],'sampledMinimum':min(values),'sampledMaximum':max(values),'validSamples':len(values),'missingSamples':0}
def delta(values):
 assert all(b>=a for a,b in zip(values,values[1:])), 'Counter reset'
 return {'delta':values[-1]-values[0],'valid':True,'missingSamples':0,'counterResets':0}
def get(obj,path):
 for part in path.split('.'):obj=obj[part]
 return obj
errors=[];checks=0
def compare(actual,expected,path):
 global checks
 checks+=1
 if isinstance(actual,dict):
  for key,value in actual.items():compare(value,expected.get(key),path+'.'+key)
 elif isinstance(actual,(float,int)) and not isinstance(actual,bool):
  if not isinstance(expected,(int,float)) or not math.isclose(actual,expected,rel_tol=1e-10,abs_tol=1e-6):errors.append({'path':path,'actual':actual,'saved':expected})
 elif actual!=expected:errors.append({'path':path,'actual':actual,'saved':expected})
summary=json.loads((D/'resources-summary.json').read_text());inputs=json.loads((D/'campaign-resource-inputs.json').read_text())
# Independently decode and bind the complete archived observer prefix.
observer=[];digest=hashlib.sha256();size=0
with gzip.open(D/'observer-prefix.jsonl.gz','rb') as source:
 for raw in source:
  digest.update(raw);size+=len(raw);value=json.loads(raw);value['_timestamp']=date(value['at']);observer.append(value)
assert digest.hexdigest()==summary['observer']['completePrefixSha256'] and size==summary['observer']['completePrefixBytes']
assert len(observer)==summary['observer']['sampleCount'] and observer[0]['at']==summary['observer']['firstAt'] and observer[-1]['at']==summary['observer']['lastAt']
assert all(b['_timestamp']>=a['_timestamp'] for a,b in zip(observer,observer[1:]))
assert sha(D/'observer.json')==summary['observer']['metadataSha256']
assert sha(D/'observer-source.py')==summary['observer']['sourceSha256']
selected=[];artifact_bindings=[]
for group in inputs:
 artifact=group['artifact'];saved_group=next(c for c in summary['campaigns'] if c['artifact']==artifact);assert saved_group['sha256']==group['sha256']
 if not any(label in artifact for label in ['arrival-fixed-v1','arrival-wide-v1','two-methods-stress-v1']):continue
 # Bind the archived focused resource records to their original full checkpoint.
 p=pathlib.Path(artifact);assert sha(p)==group['sha256'];original=json.loads(p.read_text());artifact_bindings.append({'path':artifact,'sha256':group['sha256']})
 for profile in group['profiles']:
  method=profile['candidateId'];rate=profile['rate']
  wanted=('arrival-fixed-v1' in artifact and 'maxima' in method and rate==128) or ('arrival-wide-v1' in artifact and 'sorted' in method and rate==16) or 'two-methods-stress-v1' in artifact
  if not wanted:continue
  raw_profile=next(p for p in original['profiles'] if p['candidateId']==method and p['rate']==rate)
  for field,value in profile.items():assert raw_profile[field]==value,(method,field)
  saved=next(p for p in saved_group['profiles'] if p['candidateId']==method and p['arrivalRate']==rate)
  snapshots={}
  for item in [profile['before'],*profile['samples'],profile['after']]:
   assert item and 'error' not in item and item.get('nodes')
   if item['at'] in snapshots:assert snapshots[item['at']]==item
   snapshots[item['at']]=item
  samples=sorted(snapshots.values(),key=lambda x:date(x['at']));times=[date(x['at']) for x in samples];seconds=times[-1]-times[0]
  node_ids=set(samples[0]['nodes']);assert len(node_ids)==1 and all(set(x['nodes'])==node_ids for x in samples)
  nodes=[next(iter(x['nodes'].values())) for x in samples]
  node={'identityStable':True,'resourceBracketSeconds':seconds,'processCpuMilliseconds':delta([get(x,'process.cpu.total_in_millis') for x in nodes])}
  node['meanProcessCpuCores']=node['processCpuMilliseconds']['delta']/1000/seconds
  for name,field in [('heapUsedBytes','jvm.mem.heap_used_in_bytes'),('heapMaxBytes','jvm.mem.heap_max_in_bytes'),('nonHeapUsedBytes','jvm.mem.non_heap_used_in_bytes'),('searchQueue','thread_pool.search.queue'),('activeMerges','indices.merges.current')]:node[name]=gauge([get(x,field) for x in nodes])
  node['searchRejections']=delta([get(x,'thread_pool.search.rejected') for x in nodes])
  node['gc']={key:{counter:delta([x['jvm']['gc']['collectors'][key][counter] for x in nodes]) for counter in ['collection_count','collection_time_in_millis']} for key in nodes[0]['jvm']['gc']['collectors']}
  client={'cpuMicroseconds':delta([x['clientCpu']['user']+x['clientCpu']['system'] for x in samples]),'rssBytes':gauge([x['clientMemory']['rss'] for x in samples]),'heapUsedBytes':gauge([x['clientMemory']['heapUsed'] for x in samples])}
  client['meanCpuCores']=client['cpuMicroseconds']['delta']/1e6/seconds
  compare(node,saved['node'],method+':'+str(rate)+'.node');compare(client,saved['loadGenerator'],method+':'+str(rate)+'.client')
  within=[x for x in observer if times[0]<=x['_timestamp']<=times[-1]];assert len(within)>=2
  span=within[-1]['_timestamp']-within[0]['_timestamp'];groups=[x['cgroup'] for x in within]
  interval={'requestedStart':samples[0]['at'],'requestedEnd':samples[-1]['at'],'phaseComplete':True,'samples':len(within),'firstObservedAt':within[0]['at'],'lastObservedAt':within[-1]['at'],'observedSeconds':span,'requestedSeconds':seconds,'unobservedStartSeconds':within[0]['_timestamp']-times[0],'unobservedEndSeconds':times[-1]-within[-1]['_timestamp'],'fractionCoveredByCounterWindow':span/seconds,'maximumSampleGapSeconds':max(b['_timestamp']-a['_timestamp'] for a,b in zip(within,within[1:]))}
  cpu_stats=[kv(x['cpu.stat']) for x in groups];cpu={key:delta([x[key] for x in cpu_stats]) for key in ['usage_usec','user_usec','system_usec','nr_periods','nr_throttled','throttled_usec']};quotas={x['cpu.max'] for x in groups};assert len(quotas)==1;quota,period=map(int,next(iter(quotas)).split());quota_cores=quota/period
  cpu.update(meanCores=cpu['usage_usec']['delta']/1e6/span,quotaCores=quota_cores,meanFractionOfQuota=cpu['usage_usec']['delta']/1e6/span/quota_cores,quotaValues=sorted(quotas),throttledPeriodFraction=cpu['nr_throttled']['delta']/cpu['nr_periods']['delta'])
  memory={name:gauge([int(x[field]) for x in groups]) for name,field in [('memoryChargeBytes','memory.current'),('swapChargeBytes','memory.swap.current'),('limitBytes','memory.max'),('cgroupLifetimePeakBytes','memory.peak')]}
  mem_stats=[kv(x['memory.stat']) for x in groups]
  for name,field in [('anonBytes','anon'),('fileBytes','file'),('kernelBytes','kernel'),('file_mappedBytes','file_mapped'),('file_dirtyBytes','file_dirty'),('file_writebackBytes','file_writeback'),('shmemBytes','shmem'),('swapcachedBytes','swapcached')]:memory[name]=gauge([x[field] for x in mem_stats])
  events=[kv(x['memory.events']) for x in groups];memory['events']={key:delta([x[key] for x in events]) for key in events[0]}
  pressure={}
  for resource in ['cpu','memory','io']:
   parsed=[psi(x[resource+'.pressure']) for x in groups];pressure[resource]={}
   for kind in ['some','full']:
    count=delta([x[kind]['total'] for x in parsed]);pressure[resource][kind]={'totalMicroseconds':count,'fractionOfObservedWallTime':count['delta']/1e6/span,'avg10Percent':gauge([x[kind]['avg10'] for x in parsed])}
  parsed_io=[io(x['io.stat']) for x in groups];devices={device:{key:delta([x[device][key] for x in parsed_io]) for key in parsed_io[0][device]} for device in parsed_io[0]}
  kernel={'interval':interval,'cgroupCpu':cpu,'cgroupMemory':memory,'cgroupPressure':pressure,'cgroupIoByDevice':devices}
  compare(kernel,saved['kernel'],method+':'+str(rate)+'.kernel')
  selected.append({'artifact':artifact,'candidateId':method,'rate':rate,'strictPassed':profile['viableAtTestedLoad'],'node':node,'loadGenerator':client,'kernel':kernel,'searchActiveMaximum':max(x['thread_pool']['search']['active'] for x in nodes),'openContextsMaximum':max(x['indices']['search']['open_contexts'] for x in nodes)})
assert len(selected)==6
out={'schemaVersion':1,'experiment':'independent-focused-pooled-resources','fileOnly':True,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'integrityPassed':not errors,'errors':errors,'checks':checks,'focusedProfiles':len(selected),'observerPrefix':{'sha256':digest.hexdigest(),'bytes':size,'samples':len(observer)},'artifactBindings':artifact_bindings,'profiles':selected,'sourceSha256':sha(pathlib.Path(__file__)),'inputs':[{'path':str(D/n),'sha256':sha(D/n)} for n in ['resources-summary.json','campaign-resource-inputs.json','observer-prefix.jsonl.gz','observer-source.py','observer.json']],'limitations':['No resource-helper imports or live service calls. Focused saved-resource recomputation, not a new experiment or a proof of failure causality.','Resource brackets include query instrumentation/background work; snapshot timestamps precede awaited stats reads. Kernel windows cover only samples within those brackets and retain uncovered edges.','Load-generator CPU/RSS includes evaluation scheduling, retained workload and raw evidence; it is not isolated production gateway cost.','Cgroup charge includes anonymous memory/file cache/kernel and swap; sampled component maxima need not occur together. The observed entrypoint PID is not presented as JVM RSS.','Layered-device IO counters are shown separately and must not be summed. Resource counters do not alone establish why a request failed.']}
with (R/'resources-full-million-pooled-independent-audit-v1.json').open('x') as f:json.dump(out,f,indent=2);f.write('\n')
print(json.dumps({'integrityPassed':not errors,'errors':errors,'checks':checks,'profiles':[{'id':x['candidateId'],'rate':x['rate'],'strictPassed':x['strictPassed'],'processCores':x['node']['meanProcessCpuCores'],'clientCores':x['loadGenerator']['meanCpuCores'],'cgroupCores':x['kernel']['cgroupCpu']['meanCores'],'heapPeakGiB':x['node']['heapUsedBytes']['sampledMaximum']/2**30,'chargePeakGiB':x['kernel']['cgroupMemory']['memoryChargeBytes']['sampledMaximum']/2**30,'swapLastGiB':x['kernel']['cgroupMemory']['swapChargeBytes']['last']/2**30,'cpuPressureSomePercent':x['kernel']['cgroupPressure']['cpu']['some']['fractionOfObservedWallTime']*100,'memoryPressureSomePercent':x['kernel']['cgroupPressure']['memory']['some']['fractionOfObservedWallTime']*100,'ioPressureSomePercent':x['kernel']['cgroupPressure']['io']['some']['fractionOfObservedWallTime']*100,'oomKills':x['kernel']['cgroupMemory']['events']['oom_kill']['delta'],'maxSearchQueue':x['node']['searchQueue']['sampledMaximum']} for x in selected]},indent=2))
raise SystemExit(1 if errors else 0)
