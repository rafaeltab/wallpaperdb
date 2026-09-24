import importlib.util,json,tempfile,unittest,copy
from pathlib import Path
spec=importlib.util.spec_from_file_location('gate',Path(__file__).with_name('continuation-gate-v2.py'));gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
T='2026-09-23T00:00:00Z'
class GateTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.index='color-exploration-favorite-points-full-1m-v1'
  self.plan={'index':self.index,'buildPlanSha256':'build','readiness':{k:str(self.root/(k+'.json')) for k in ['buildStatus','receipt','numericAudit']}}
  self.status={'startedAt':T,'finishedAt':T,'planSha256':'build','phases':[{'id':i,'finishedAt':T,'exitCode':0} for i in ['points-full-1m-index','points-full-1m-audit']]}
  config={'scope':'full','mode':'scale','presets':'favorite','encodings':['numeric'],'numericPoints':True,'source':False,'count':1000000,'base':'http://127.0.0.1:19217'}
  self.receipt={'startedAt':T,'finishedAt':T,'configuration':config,'index':self.index,'indexed':1000000,'generated':1000000,'count':1000000,'base':config['base'],'utilities':6138,'uuid':'uuid','identityHash':'identity','planHash':'plan','sourceSnapshotHash':'source','after':{'settings':{self.index:{'settings':{'index':{'uuid':'uuid'}}}}}}
  self.audit={'startedAt':T,'finishedAt':T,'verified':True,'readOnly':True,'index':self.index,'count':1000000,'scope':'full','presets':'favorite','numericPoints':True,'uuid':'uuid','identityHash':'identity','planHash':'plan','parentSourceSnapshotHash':'source','beforeFingerprintHash':'same','afterFingerprintHash':'same','sampleAudit':{'verified':True,'valuesCompared':18414,'utilitiesPerSample':6138,'ordinals':[0,499999,999999]}}
 def tearDown(self):self.temp.cleanup()
 def write(self):
  for name,obj in [('buildStatus',self.status),('receipt',self.receipt)]:Path(self.plan['readiness'][name]).write_text(json.dumps(obj))
  self.audit['receiptHash']=gate.sha(Path(self.plan['readiness']['receipt']).read_bytes());Path(self.plan['readiness']['numericAudit']).write_text(json.dumps(self.audit))
 def test_missing_waits(self):self.assertFalse(gate.readiness(self.plan)['ready'])
 def test_partial_receipt_never_becomes_million(self):
  del self.status['finishedAt'];self.status['phases']=self.status['phases'][:1];del self.status['phases'][0]['exitCode']
  del self.receipt['finishedAt'];del self.receipt['count'];self.receipt['indexed']=200000;self.write()
  result=gate.readiness(self.plan);self.assertFalse(result['ready']);self.assertIsNone(result['verifiedCount']);self.assertEqual(result['acknowledgedDocuments'],200000)
 def test_complete_and_bound(self):
  self.write();self.assertTrue(gate.readiness(self.plan)['ready']);self.assertEqual(gate.readiness(self.plan)['verifiedCount'],1000000)
 def test_completed_wrong_count_rejected(self):
  self.receipt['count']=999999;self.write()
  with self.assertRaises(gate.GateFailure):gate.readiness(self.plan)
 def test_failed_phase_rejected(self):
  self.status['phases'][1]['exitCode']=1;self.write()
  with self.assertRaises(gate.GateFailure):gate.readiness(self.plan)
 def test_audit_requires_verified_full_bank_samples(self):
  for field,value in [('verified',False),('valuesCompared',18413),('utilitiesPerSample',9)]:
   with self.subTest(field=field):
    original=self.audit['sampleAudit'][field];self.audit['sampleAudit'][field]=value;self.write()
    with self.assertRaises(gate.GateFailure):gate.readiness(self.plan)
    self.audit['sampleAudit'][field]=original
 def test_stale_receipt_audit_binding_rejected(self):
  self.write();self.receipt['extra']='changed';Path(self.plan['readiness']['receipt']).write_text(json.dumps(self.receipt))
  with self.assertRaises(gate.GateFailure):gate.readiness(self.plan)
 def test_empty_valid_json_is_not_ready(self):
  self.write();Path(self.plan['readiness']['buildStatus']).write_text('{}')
  with self.assertRaises(gate.GateFailure):gate.readiness(self.plan)
 def test_pins_detect_changes(self):
  p=self.root/'p';p.write_text('a');plan={'pins':[{'path':str(p),'sha256':gate.sha(p.read_bytes())}]};gate.check_pins(plan);p.write_text('b')
  with self.assertRaises(gate.GateFailure):gate.check_pins(plan)
 def test_failures_and_coverage_remain_visible(self):
  coverage=[{'candidateId':'candidate','successful':{'fullUtilityBankCovered':False}}]
  result=gate.strict_summary({'profiles':[{'viableAtTestedLoad':False,'trials':[{'elapsedMs':1},{'elapsedMs':1200,'error':'timeout'}]}],'warmups':[{'elapsedMs':1000}],'candidateCoverage':coverage})
  self.assertEqual(result['timedStrictFailures'],1);self.assertEqual(result['warmupStrictFailures'],1);self.assertEqual(result['failedProfiles'],1);self.assertEqual(result['actualCoverage'],coverage)


import os,signal,subprocess,sys,time
from unittest.mock import patch

class ProcessTests(unittest.TestCase):
 def child_still_running(self,pid):
  try:return Path('/proc/'+str(pid)+'/stat').read_text().split()[2] not in ['Z','X']
  except FileNotFoundError:return False
 def exercise_group(self,leader_exits):
  with tempfile.TemporaryDirectory() as root:
   pidfile=Path(root)/'child-pid'
   child="import os,signal,time;from pathlib import Path;signal.signal(signal.SIGTERM,signal.SIG_IGN);Path("+repr(str(pidfile))+").write_text(str(os.getpid()));time.sleep(60)"
   parent="import subprocess,sys,time;subprocess.Popen([sys.executable,'-c',"+repr(child)+"]);"+("time.sleep(.05)" if leader_exits else "time.sleep(60)")
   process=subprocess.Popen([sys.executable,'-c',parent],start_new_session=True)
   try:
    deadline=time.monotonic()+3
    while not pidfile.exists() and time.monotonic()<deadline:time.sleep(.01)
    self.assertTrue(pidfile.exists());pid=int(pidfile.read_text())
    if leader_exits:process.wait(timeout=2)
    with patch.object(gate,'TERMINATION_GRACE_SECONDS',.05):gate.terminate(process)
    deadline=time.monotonic()+2
    while self.child_still_running(pid) and time.monotonic()<deadline:time.sleep(.01)
    self.assertFalse(self.child_still_running(pid));self.assertIsNotNone(process.poll())
   finally:
    gate.signal_group(process.pid,signal.SIGKILL);process.wait(timeout=2)
 def test_cleanup_kills_ignoring_descendant_after_leader_exits(self):self.exercise_group(True)
 def test_cleanup_kills_ignoring_descendant_while_leader_exits_on_term(self):self.exercise_group(False)
 def test_missing_group_races_are_harmless(self):
  process=subprocess.Popen([sys.executable,'-c','pass'],start_new_session=True);process.wait()
  gate.terminate(process);self.assertFalse(gate.group_alive(process.pid))

class ExecutionTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.events=self.root/'events'
  self.plan={'schemaVersion':1,'experiment':'test','artifactRoot':str(self.root),'repository':str(self.root),'budgetSeconds':5,'pollSeconds':.01,'pins':[],'freshPaths':[],'stages':[]}
 def tearDown(self):self.temp.cleanup()
 def stage(self,id,result=None,audit_accepted=True,delay=0,exit_code=0,no_artifact=False):
  directory=self.root/id;artifact=directory/'result.json';audit=directory/'audit.json'
  code="import json,time;from pathlib import Path;time.sleep("+str(delay)+");Path("+repr(str(directory))+").mkdir();"
  code+="Path("+repr(str(self.events))+").open('a').write("+repr(id+'\n')+");"
  if not no_artifact:code+="Path("+repr(str(artifact))+").write_text("+repr(json.dumps(result or {'finishedAt':T,'profiles':[]}))+");"
  if no_artifact:code+="print('No candidates have complete passing C1 evidence; no arrival campaign can run.');"
  code+="raise SystemExit("+str(exit_code)+")"
  auditcode="from pathlib import Path;Path("+repr(str(self.events))+").open('a').write("+repr('audit-'+id+'\n')+");Path("+repr(str(audit))+").write_text("+repr(json.dumps({'accepted':audit_accepted,'integrityPassed':audit_accepted}))+ ")"
  self.plan['stages'].append({'id':id,'command':[sys.executable,'-c',code],'artifact':str(artifact),'auditCommand':[sys.executable,'-c',auditcode],'auditOutput':str(audit)})
  self.plan['freshPaths'].append(str(directory))
 def execute(self,validation=None):
  planfile=self.root/'plan.json';planfile.write_text(json.dumps(self.plan));state=self.root/'state'
  with patch.object(sys,'argv',['gate','--plan',str(planfile),'--directory',str(state),'--execute']),patch.object(gate,'validate_static',validation or (lambda plan:True)),patch.object(gate,'check_pins',lambda plan:None),patch.object(gate,'readiness',lambda plan:{'ready':True,'artifacts':{'proof':'hash'}}),patch.object(gate,'TERMINATION_GRACE_SECONDS',.05):
   gate.main()
  return json.loads((state/'status.json').read_text())
 def test_serial_measurement_audit_pairs_preserve_performance_failures(self):
  self.stage('one',{'finishedAt':T,'profiles':[{'viableAtTestedLoad':False,'trials':[{'elapsedMs':1200,'error':'slow'}]}]});self.stage('two')
  state=self.execute();self.assertEqual(state['status'],'complete');self.assertEqual(self.events.read_text().splitlines(),['one','audit-one','two','audit-two'])
  self.assertEqual(state['stages'][0]['measurementSummary']['timedStrictFailures'],1)
 def test_audit_failure_prevents_next_measurement(self):
  self.stage('one',audit_accepted=False);self.stage('two')
  with self.assertRaises(gate.GateFailure):self.execute()
  self.assertEqual(self.events.read_text().splitlines(),['one','audit-one']);self.assertEqual(json.loads((self.root/'state/status.json').read_text())['status'],'stopped')
 def test_deadline_stops_serial_work_and_records_error(self):
  self.plan['budgetSeconds']=.1;self.stage('one',delay=3);self.stage('two')
  with self.assertRaises(gate.GateFailure):self.execute()
  self.assertFalse(self.events.exists());state=json.loads((self.root/'state/status.json').read_text());self.assertEqual(state['status'],'stopped');self.assertIn('deadline',state['error'])
 def test_failed_measurement_still_gets_partial_evidence_audit(self):
  self.stage('one',{'profiles':[]},audit_accepted=False,exit_code=1);self.stage('two')
  with self.assertRaises(gate.GateFailure):self.execute()
  self.assertEqual(self.events.read_text().splitlines(),['one','audit-one'])
 def test_no_qualified_candidates_is_explicit_terminal_state(self):
  self.stage('one',exit_code=1,no_artifact=True)
  with self.assertRaises(gate.NoQualifiedCandidates):self.execute()
  state=json.loads((self.root/'state/status.json').read_text());self.assertEqual(state['status'],'no-qualified-candidates');self.assertEqual(self.events.read_text().splitlines(),['one'])
 def test_startup_validation_failure_is_persisted(self):
  def fail(plan):raise gate.GateFailure('pin changed')
  with self.assertRaises(gate.GateFailure):self.execute(validation=fail)
  state=json.loads((self.root/'state/status.json').read_text());self.assertEqual(state['status'],'stopped');self.assertIn('pin changed',state['error'])

if __name__=='__main__':unittest.main()
