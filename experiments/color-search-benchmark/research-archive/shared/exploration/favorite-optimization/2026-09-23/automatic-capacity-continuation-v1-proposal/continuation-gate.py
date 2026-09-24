"""File-only readiness gate, then serial existing Make campaigns. Never imports
or calls OpenSearch. No work starts without --execute; root reviews first.
Run in a persistent user systemd unit. No resume, overwrite or index mutations.
"""
import argparse, datetime, hashlib, json, os, signal, subprocess, sys, time
from pathlib import Path

class GateFailure(RuntimeError): pass
class NoQualifiedCandidates(GateFailure): pass

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(data): return hashlib.sha256(data).hexdigest()
def require(value, message):
    if not value: raise GateFailure(message)
def load(filename): return json.loads(Path(filename).read_bytes())
def stamp(value):
    try: return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).tzinfo is not None
    except (ValueError, TypeError, AttributeError): return False

def atomic(directory, name, value):
    temporary=directory/(name+'.tmp')
    with temporary.open('w') as out:
        json.dump(value,out,indent=2);out.flush();os.fsync(out.fileno())
    os.replace(temporary,directory/name)

def check_pins(plan):
    for item in plan['pins']:
        require(sha(Path(item['path']).read_bytes())==item['sha256'], 'Pinned input changed: '+item['path'])

def validate_static(plan):
    require(plan['schemaVersion']==1 and plan['experiment']=='favorite-automatic-capacity-continuation','Unknown plan')
    require(0<plan['pollSeconds']<=30 and plan['budgetSeconds']==21600,'Require <=30s polling and six-hour budget')
    check_pins(plan)
    config=load(plan['candidateConfig'])
    methods=['favorite-utility-numeric-docvalues','favorite-utility-sorted-docvalues','favorite-utility-bounded','favorite-utility-maxima-bounded']
    require([c['method'] for c in config['candidates']]==methods,'Four candidate methods changed')
    require(all(c['index']==plan['index'] for c in config['candidates']),'Candidate index changed')
    q=load(plan['proofs']['qa17']);require(q['passed'] is True and q['browserClosed'] is True and len(q['initial']['cards'])==17 and not q['consoleErrors'] and not q['fixtureLeaks'],'UI17 QA is incomplete')
    f=load(plan['proofs']['maximaFidelity']);a=load(plan['proofs']['maximaAudit'])
    require(f['passed'] is True and stamp(f['finishedAt']) and len(f['rows'])==626,'Maxima fidelity is incomplete')
    require(a['integrityPassed'] is True and a['experimentPassed'] is True and a['executions']==626,'Maxima independent audit failed')
    require(a['summaryHash']==sha(Path(plan['proofs']['maximaFidelity']).read_bytes()) and a['sourceSnapshotHash']==f['sourceSnapshotHash'],'Maxima audit binding changed')
    run=load(plan['proofs']['maximaFeedback']);audit=load(plan['proofs']['maximaFeedbackAudit']);execution=load(plan['proofs']['maximaFeedbackPathAudit'])
    runhash=sha(Path(plan['proofs']['maximaFeedback']).read_bytes())
    require(audit['integrityPassed'] is True and not audit['errors'] and audit['hashes']['run']==runhash,'Maxima feedback audit failed')
    require(execution['verified'] is True and execution['runSha256']==runhash,'Maxima feedback executor proof failed')
    require(len(run['candidates'])==4 and all(c['summary']['coverage']['ok']==32 and c['summary']['coverage']['error']==0 and c['summary']['coverage']['unsupported']==6 for c in run['candidates']),'Maxima feedback incomplete')
    shard=load(plan['proofs']['multishardAudit']);require(shard['passed'] is True and shard['executions']==1920,'Multishard proof missing')
    expected=['screen','fixed','varied','wide-cycle']
    require([stage['id'] for stage in plan['stages']]==expected,'Unexpected campaign order')
    for stage in plan['stages']:
        for command in [stage['command'],stage['auditCommand']]:
            require(command[0]=='make' and command[1] in ['color-favorite-optimization-pipeline','color-favorite-optimization-audit','color-favorite-optimization-arrival','color-favorite-optimization-arrival-audit'],'Unexpected command')
            require(len(command)==3 and command[2].startswith('COLOR_FAVORITE_ARGS='),'Unexpected Make variables')
    return True

def readiness(plan):
    """Missing/in-progress artifacts wait; completed failure or contradiction stops."""
    paths=plan['readiness']; evidence={}; waiting=[]
    for name,filename in paths.items():
        try:
            raw=Path(filename).read_bytes();evidence[name]={'sha256':sha(raw),'data':json.loads(raw)}
        except FileNotFoundError: waiting.append(name+' missing')
        except json.JSONDecodeError: waiting.append(name+' currently incomplete JSON')
    state=evidence.get('buildStatus',{}).get('data')
    if state is not None:
        require(isinstance(state,dict) and stamp(state.get('startedAt')),'Malformed build status')
        require(not state.get('error') and not state.get('stoppedAt'),'Build pipeline stopped')
        phases=state.get('phases',[])
        require(all(row.get('exitCode',0)==0 for row in phases),'Build or stored-value audit exited nonzero')
        require(state.get('planSha256')==plan['buildPlanSha256'],'Build plan identity changed')
        if not state.get('finishedAt'):waiting.append('build pipeline running')
        else:
            require(stamp(state['finishedAt']) and [row['id'] for row in phases]==['points-full-1m-index','points-full-1m-audit'],'Completed pipeline phases differ')
            require(all(row.get('exitCode')==0 and stamp(row.get('finishedAt')) for row in phases),'Both pipeline phases must finish with exit0')
    receipt=evidence.get('receipt',{}).get('data')
    if receipt is not None:
        require(isinstance(receipt,dict) and stamp(receipt.get('startedAt')),'Malformed index receipt')
        require(not receipt.get('error') and not receipt.get('interruptedAt'),'Index receipt records failure')
        if not receipt.get('finishedAt'):waiting.append('index receipt incomplete')
        else:
            config=receipt['configuration']
            require(stamp(receipt['finishedAt']) and receipt['index']==plan['index'] and receipt['count']==receipt['indexed']==receipt['generated']==1000000,'Completed receipt must verify one million documents')
            require(config['scope']=='full' and config['mode']=='scale' and config['presets']=='favorite' and config['encodings']==['numeric'] and config['numericPoints'] is True and config['source'] is False and config['count']==1000000,'Completed index configuration differs')
            require(receipt['base']==config['base']=='http://127.0.0.1:19217' and receipt['utilities']==6138 and receipt['uuid'],'Completed index identity differs')
            require(receipt['after']['settings'][plan['index']]['settings']['index']['uuid']==receipt['uuid'],'Receipt UUID binding differs')
    audit=evidence.get('numericAudit',{}).get('data')
    if audit is not None:
        require(isinstance(audit,dict) and stamp(audit.get('startedAt')),'Malformed numeric audit')
        require(not audit.get('error'),'Stored-value audit records failure')
        if not audit.get('finishedAt'):waiting.append('stored-value audit incomplete')
        else:
            require(audit['verified'] is True and audit['readOnly'] is True and stamp(audit['finishedAt']),'Stored-value audit failed')
            require(audit['index']==plan['index'] and audit['count']==1000000 and audit['scope']=='full' and audit['presets']=='favorite' and audit['numericPoints'] is True,'Stored-value audit scope differs')
            require(audit['sampleAudit']['verified'] is True and audit['sampleAudit']['valuesCompared']==18414 and audit['sampleAudit']['utilitiesPerSample']==6138 and audit['sampleAudit']['ordinals']==[0,499999,999999],'Stored-value sample audit incomplete')
            require(audit['beforeFingerprintHash']==audit['afterFingerprintHash'],'Index changed during value audit')
            if receipt and receipt.get('finishedAt'):
                require(audit['receiptHash']==evidence['receipt']['sha256'] and audit['uuid']==receipt['uuid'] and audit['identityHash']==receipt['identityHash'] and audit['planHash']==receipt['planHash'] and audit['parentSourceSnapshotHash']==receipt['sourceSnapshotHash'],'Stored-value audit is not bound to completed receipt')
    return {'ready':not waiting,'waiting':waiting,'artifacts':{k:v['sha256'] for k,v in evidence.items()},
            'acknowledgedDocuments':receipt.get('indexed') if receipt else None,
            'verifiedCount':receipt.get('count') if receipt and receipt.get('finishedAt') else None}

def strict_summary(result):
    profiles=result.get('profiles',[])
    trials=[t for p in profiles for t in p.get('trials',[])]
    warm=[t for w in result.get('warmups',[]) for t in w.get('trials',[w])]
    bad=lambda t:bool(t.get('error')) or not isinstance(t.get('elapsedMs'),(int,float)) or not __import__('math').isfinite(t['elapsedMs']) or t['elapsedMs']<0 or t['elapsedMs']>=1000
    return {'profiles':len(profiles),'timedRequests':len(trials),'timedStrictFailures':sum(bad(t) for t in trials),
            'warmupRequests':len(warm),'warmupStrictFailures':sum(bad(t) for t in warm),
            'failedProfiles':sum(p.get('viableAtTestedLoad') is not True for p in profiles),'skipped':result.get('skipped',[]),
            'selectedCandidates':[c['id'] for c in result.get('selection',{}).get('selected',[])],
            'actualCoverage':result.get('candidateCoverage',[])}

def terminate(process):
    if process and process.poll() is None:
        os.killpg(process.pid,signal.SIGTERM)
        try:process.wait(timeout=10)
        except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--plan',type=Path,required=True);parser.add_argument('--directory',type=Path);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    raw=args.plan.read_bytes();plan=json.loads(raw);validate_static(plan)
    if not args.execute:
        print(json.dumps({'checkOnly':True,'staticPassed':True,'readiness':readiness(plan)},indent=2));return
    require(args.directory is not None,'--execute requires a fresh --directory')
    directory=args.directory.resolve();require(str(directory).startswith(plan['artifactRoot']+'/'),'Gate state must stay under the external artifact root')
    directory.mkdir(parents=True,exist_ok=False)
    (directory/'plan.json').write_bytes(raw);(directory/'gate-source.py').write_bytes(Path(__file__).read_bytes())
    state={'experiment':plan['experiment'],'startedAt':now(),'planSha256':sha(raw),'budgetSeconds':plan['budgetSeconds'],'status':'waiting','polls':0,'stages':[]}
    deadline=time.monotonic()+plan['budgetSeconds'];active=None
    def save():atomic(directory,'status.json',state)
    def check_time():require(time.monotonic()<deadline,'Six-hour continuation deadline exceeded')
    def stop(signum,frame):raise GateFailure('Interrupted by signal '+str(signum))
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop);save()
    def frozen():require(args.plan.read_bytes()==raw,'Continuation plan changed');check_pins(plan)
    def run(command,logname):
        nonlocal active
        check_time();frozen()
        with (directory/logname).open('xb') as out:
            active=subprocess.Popen(command,cwd=plan['repository'],stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
            state['activeProcess']={'pid':active.pid,'command':command};save()
            try:code=active.wait(timeout=max(.01,deadline-time.monotonic()))
            except subprocess.TimeoutExpired:terminate(active);raise GateFailure('Six-hour deadline exceeded during '+logname)
            finally:
                if active.poll() is not None:active=None;state.pop('activeProcess',None)
        return code
    try:
        for filename in plan['freshPaths']:require(not Path(filename).exists(),'Output already exists: '+filename)
        previous=None
        while True:
            check_time();frozen();ready=readiness(plan);state['polls']+=1;state['readiness']=ready;save()
            summary=json.dumps(ready,sort_keys=True)
            if summary!=previous:
                with (directory/'readiness.jsonl').open('a') as log:log.write(json.dumps({'at':now(),**ready})+'\n')
                previous=summary
            if ready['ready']:break
            time.sleep(min(plan['pollSeconds'],max(0,deadline-time.monotonic())))
        for filename in plan['freshPaths']:require(not Path(filename).exists(),'Output appeared while waiting: '+filename)
        ready_hashes=ready['artifacts'];state['readyAt']=now();state['status']='running';save()
        for stage in plan['stages']:
            check_time();frozen();current=readiness(plan)
            require(current['ready'] and current['artifacts']==ready_hashes,'Readiness evidence changed after completion')
            row={'id':stage['id'],'startedAt':now(),'command':stage['command']};state['stages'].append(row);save()
            row['exitCode']=run(stage['command'],stage['id']+'.log');row['measurementFinishedAt']=now();save()
            if Path(stage['artifact']).exists():
                result=load(stage['artifact']);row['measurementSummary']=strict_summary(result);row['artifactSha256']=sha(Path(stage['artifact']).read_bytes());save()
                row['auditExitCode']=run(stage['auditCommand'],stage['id']+'-audit.log')
                if Path(stage['auditOutput']).exists():row['audit']=load(stage['auditOutput'])
            else:row['auditSkipped']='Measurement did not produce its expected artifact; no evidence to audit'
            row['finishedAt']=now();save()
            if row['exitCode'] and not Path(stage['artifact']).exists() and 'No candidates have complete passing C1 evidence; no arrival campaign can run.' in (directory/(stage['id']+'.log')).read_text():
                raise NoQualifiedCandidates('Existing arrival harness found no candidates with complete passing C1 evidence; no arrival load ran')
            require(row['exitCode']==0,'Measurement failed: '+stage['id'])
            require(row.get('auditExitCode')==0 and row.get('audit',{}).get('accepted') is True and row['audit'].get('integrityPassed') is True,'Evidence audit incomplete or failed: '+stage['id'])
            require(stamp(result.get('finishedAt')) and not result.get('interruption'),'Measurement is incomplete: '+stage['id'])
            # Performance failures remain evidence; existing harness qualifies
            # candidates and skips their higher rates. Never promote missing runs.
        state['status']='complete';state['finishedAt']=now();save()
    except BaseException as error:
        terminate(active);state['status']='no-qualified-candidates' if isinstance(error,NoQualifiedCandidates) else 'stopped';state['stoppedAt']=now();state['error']=repr(error);save();raise

if __name__=='__main__':main()
