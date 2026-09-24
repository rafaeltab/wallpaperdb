import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('resources', Path(__file__).with_name('resource_summary.py'))
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
T = '2026-09-23T00:00:'

def row(second, cpu=0, anon=200, file=600, peak=9000):
    return {'at': T + f'{second:02d}Z', 'cgroup': {'cpu.stat': f'usage_usec {cpu}\nuser_usec {cpu}\nsystem_usec 0\nnr_periods {second}\nnr_throttled 0\nthrottled_usec 0',
      'cpu.max': '800000 100000', 'memory.current': str(anon+file+50), 'memory.peak': str(peak), 'memory.max': '1000',
      'memory.swap.current': '50', 'memory.stat': f'anon {anon}\nfile {file}\nkernel 50\nfile_mapped 300\nfile_dirty 100',
      'memory.events': 'max 5\noom 0\noom_kill 0',
      'io.stat': f'259:0 rbytes={second*10} wbytes={second*20} rios=0 wios=0 dbytes=0 dios=0\n252:0 rbytes={second*10} wbytes={second*20} rios=0 wios=0 dbytes=0 dios=0',
      **{kind+'.pressure': f'some avg10=1 total={second*10000}\nfull avg10=0 total=0' for kind in ['cpu','memory','io']}},
      'processMemory': {'VmRSS': '2 kB', 'VmHWM': '3 kB', 'RssAnon': '1 kB', 'RssFile': '1 kB', 'VmSwap': '1 kB'},
      'hostMeminfo': 'MemTotal: 2000 kB\nMemAvailable: 1000 kB\nSwapTotal: 500 kB\nSwapFree: 10 kB',
      'hostPressure': {kind: f'some avg10=1 total={second*20000}\nfull avg10=0 total=0' for kind in ['cpu','memory','io']}}

def phase(start=1, end=9, complete=True):
    return {'id':'phase','kind':'indexing','startedAt':T+f'{start:02d}Z','endedAt':T+f'{end:02d}Z','complete':complete}

def node_sample(second, cpu, client, node_id='one'):
    return {'at':T+f'{second:02d}Z','nodes':{node_id:{'process':{'cpu':{'total_in_millis':cpu},'mem':{'total_virtual_in_bytes':1000000}},
      'jvm':{'mem':{'heap_used_in_bytes':400,'heap_max_in_bytes':1000,'non_heap_used_in_bytes':50},'gc':{'collectors':{'young':{'collection_count':second,'collection_time_in_millis':second*2}}}},
      'thread_pool':{'search':{'rejected':0,'queue':0}},'indices':{'merges':{'current':0}}}},
      'clientCpu':{'user':client,'system':0},'clientMemory':{'rss':80,'heapUsed':20}}

class ResourceTests(unittest.TestCase):
    def test_phase_uses_only_interior_samples_and_reports_edges(self):
        samples=[r.normalize_observation(row(s,s*1_000_000)) for s in [0,2,4,8,10]]
        result=r.summarize_phase(samples,phase())
        self.assertEqual(result['interval']['samples'],3);self.assertEqual(result['interval']['unobservedStartSeconds'],1)
        self.assertEqual(result['interval']['unobservedEndSeconds'],1);self.assertEqual(result['interval']['fractionCoveredByCounterWindow'],.75)
        self.assertEqual(result['cgroupCpu']['meanCores'],1);self.assertEqual(result['cgroupCpu']['meanFractionOfQuota'],.125)
    def test_no_samples_never_invents_zero_usage(self):
        result=r.summarize_phase([],phase())
        self.assertIsNone(result['cgroupCpu']['usage_usec']['delta']);self.assertIsNone(result['cgroupMemory']['memoryChargeBytes']['sampledMaximum'])
        self.assertEqual(result['interval']['samples'],0)
    def test_counter_reset_in_middle_is_not_hidden_by_positive_end_delta(self):
        change=r.delta([100,200,5,300]);self.assertFalse(change['valid']);self.assertIsNone(change['delta']);self.assertEqual(change['counterResets'],1)
        self.assertFalse(r.delta([100,None,300])['valid']);self.assertFalse(r.delta([100])['valid'])
    def test_file_subsets_swap_and_lifetime_peak_remain_separate(self):
        result=r.summarize_phase([r.normalize_observation(row(s)) for s in [2,8]],phase())['cgroupMemory']
        self.assertEqual(result['memoryChargeBytes']['sampledMaximum'],850);self.assertEqual(result['anonBytes']['sampledMaximum'],200)
        self.assertEqual(result['fileBytes']['sampledMaximum'],600);self.assertEqual(result['file_mappedBytes']['sampledMaximum'],300)
        self.assertEqual(result['cgroupLifetimePeakBytes']['sampledMaximum'],9000);self.assertEqual(result['swapChargeBytes']['sampledMaximum'],50)
        self.assertEqual(result['events']['oom']['delta'],0)
    def test_layered_device_bytes_are_not_summed(self):
        result=r.summarize_phase([r.normalize_observation(row(s)) for s in [2,8]],phase())
        self.assertEqual(set(result['cgroupIoByDevice']),{'259:0','252:0'})
        self.assertEqual(result['cgroupIoByDevice']['259:0']['wbytes']['delta'],120)
        self.assertEqual(result['cgroupIoByDevice']['252:0']['wbytes']['delta'],120)
        self.assertNotIn('totalIoBytes',result)
    def test_host_pressure_and_entrypoint_rss_do_not_become_jvm_metrics(self):
        result=r.summarize_phase([r.normalize_observation(row(s)) for s in [2,8]],phase())
        self.assertEqual(result['observedEntrypointProcessMemory']['VmRSS']['sampledMaximum'],2048)
        self.assertEqual(result['cgroupPressure']['cpu']['some']['fractionOfObservedWallTime'],.01)
        self.assertEqual(result['hostPressure']['cpu']['some']['fractionOfObservedWallTime'],.02)
        self.assertNotIn('jvm',result)
    def test_complete_prefix_ignores_unfinished_line_but_rejects_corrupt_complete_line(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'rows';raw=json.dumps(row(2)).encode()+b'\n';file.write_bytes(raw+b'{"at":')
            rows,prefix,metadata=r.read_complete_jsonl(file)
            self.assertEqual(len(rows),1);self.assertEqual(prefix,raw);self.assertEqual(metadata['ignoredIncompleteTailBytes'],6)
            file.write_bytes(raw+b'bad\n')
            with self.assertRaises(json.JSONDecodeError):r.read_complete_jsonl(file)
    def test_out_of_order_timestamps_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'rows';file.write_text('\n'.join(json.dumps(row(s)) for s in [4,2])+'\n')
            with self.assertRaises(ValueError):r.read_complete_jsonl(file)
    def test_jvm_heap_client_rss_and_virtual_address_space_have_distinct_labels(self):
        before,after=node_sample(2,1000,1000),node_sample(8,7000,601000)
        profile={'before':before,'after':after,'samples':[before,after],'trials':[{}]}
        result=r.summarize_benchmark_profile(profile,[],'screen')
        self.assertEqual(result['node']['meanProcessCpuCores'],1);self.assertAlmostEqual(result['loadGenerator']['meanCpuCores'],.1)
        self.assertEqual(result['node']['heapUsedBytes']['sampledMaximum'],400)
        self.assertEqual(result['node']['virtualAddressSpaceBytes']['sampledMaximum'],1000000)
        self.assertIsNone(result['node']['residentMemoryBytes']);self.assertEqual(result['loadGenerator']['rssBytes']['sampledMaximum'],80)
        self.assertEqual(result['node']['heapUsedBytes']['validSamples'],2)
    def test_changed_node_identity_invalidates_cpu_attribution(self):
        profile={'before':node_sample(2,1000,1000),'after':node_sample(8,7000,601000,'new')}
        result=r.summarize_benchmark_profile(profile,[],'screen')
        self.assertFalse(result['node']['identityStable']);self.assertFalse(result['node']['processCpuMilliseconds']['valid']);self.assertIsNone(result['node']['meanProcessCpuCores'])
        self.assertFalse(result['node']['searchRejections']['valid'])
        self.assertFalse(result['node']['gc']['young']['collection_count']['valid'])
        self.assertFalse(result['node']['gc']['young']['collection_time_in_millis']['valid'])

    def test_interrupted_campaign_stops_at_interruption(self):
        campaign={'startedAt':T+'00Z','interruption':{'at':T+'08Z'}}
        result=r.campaign_phase(campaign,'arrivals',T+'20Z')
        self.assertEqual(result['endedAt'],T+'08Z');self.assertFalse(result['complete'])
        result=r.campaign_phase({**campaign,'finishedAt':T+'09Z'},'arrivals',T+'20Z')
        self.assertEqual(result['endedAt'],T+'09Z');self.assertFalse(result['complete'])
    def test_failed_and_missing_resource_samples_remain_visible(self):
        before,after=node_sample(2,1000,1000),node_sample(8,7000,601000)
        profile={'before':before,'after':after,'samples':[before,{'error':'read failed'},{'at':T+'04Z'},after]}
        result=r.summarize_benchmark_profile(profile,[],'arrivals')
        self.assertEqual(result['resourceSampleErrors'],1)
        self.assertEqual(result['resourceSampleEvidence']['failedReads'],1)
        self.assertEqual(result['resourceSampleEvidence']['missingOrMalformedReads'],1)
        self.assertFalse(result['resourceSampleEvidence']['complete'])
        self.assertFalse(result['node']['processCpuMilliseconds']['valid'])
        self.assertFalse(result['node']['searchRejections']['valid'])
        self.assertFalse(result['node']['gc']['young']['collection_count']['valid'])
        self.assertEqual(result['node']['heapUsedBytes']['validSamples'],2)
    def test_missing_resource_bracket_preserves_error_count(self):
        profile={'samples':[{'error':'cannot read stats'}]}
        result=r.summarize_benchmark_profile(profile,[],'arrivals')
        self.assertFalse(result['available']);self.assertEqual(result['resourceSampleErrors'],1)
        self.assertFalse(result['resourceSampleEvidence']['complete'])

if __name__=='__main__':unittest.main()
