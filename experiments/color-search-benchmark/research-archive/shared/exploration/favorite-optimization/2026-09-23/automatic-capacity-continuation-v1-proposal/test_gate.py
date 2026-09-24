import importlib.util,json,tempfile,unittest,copy
from pathlib import Path
spec=importlib.util.spec_from_file_location('gate',Path(__file__).with_name('continuation-gate.py'));gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
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
if __name__=='__main__':unittest.main()
