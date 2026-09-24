"""Summarize saved kernel/JVM/client observations. No service or /proc reads."""
import argparse
import datetime
import gzip
import hashlib
import json
import math
from pathlib import Path


def sha(data): return hashlib.sha256(data).hexdigest()
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def epoch(value): return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError): return None


def counters(text):
    if not isinstance(text, str): return {}
    result = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and number(parts[1]) is not None: result[parts[0]] = int(parts[1])
    return result


def pressure(text):
    if not isinstance(text, str): return {}
    result = {}
    for line in text.splitlines():
        parts = line.split()
        if parts: result[parts[0]] = {key: number(value) for key, value in (word.split('=', 1) for word in parts[1:] if '=' in word)}
    return result


def io_devices(text):
    if not isinstance(text, str): return {}
    result = {}
    for line in text.splitlines():
        parts = line.split()
        if parts: result[parts[0]] = {key: number(value) for key, value in (word.split('=', 1) for word in parts[1:] if '=' in word)}
    return result


def memory_bytes(text):
    if not isinstance(text, str): return {}
    result = {}
    for line in text.splitlines():
        if ':' not in line: continue
        key, value = line.split(':', 1); parts = value.split()
        if len(parts) == 2 and parts[1] == 'kB' and number(parts[0]) is not None: result[key] = int(parts[0]) * 1024
    return result


def gauge(values):
    valid = [value for value in values if isinstance(value, (int, float)) and math.isfinite(value)]
    return {'first': values[0] if values else None, 'last': values[-1] if values else None,
      'sampledMinimum': min(valid) if valid else None, 'sampledMaximum': max(valid) if valid else None,
      'validSamples': len(valid), 'missingSamples': len(values) - len(valid)}


def delta(values):
    valid = [isinstance(value, (int, float)) and math.isfinite(value) for value in values]
    resets = sum(valid[i] and valid[i-1] and values[i] < values[i-1] for i in range(1, len(values)))
    missing = len(valid) - sum(valid)
    passed = len(values) >= 2 and not missing and not resets
    return {'delta': values[-1] - values[0] if passed else None, 'valid': passed, 'missingSamples': missing, 'counterResets': resets}


def read_complete_jsonl(filename):
    raw = Path(filename).read_bytes()
    boundary = raw.rfind(b'\n') + 1
    complete = raw[:boundary]
    rows = [json.loads(line) for line in complete.splitlines() if line]
    times = [epoch(row['at']) for row in rows]
    if any(right < left for left, right in zip(times, times[1:])): raise ValueError('Observer timestamps moved backwards; do not silently reorder counters')
    return rows, complete, {'path': str(filename), 'completePrefixSha256': sha(complete), 'completePrefixBytes': len(complete),
      'ignoredIncompleteTailBytes': len(raw) - len(complete), 'sampleCount': len(rows), 'firstAt': rows[0]['at'] if rows else None, 'lastAt': rows[-1]['at'] if rows else None}


def normalize_observation(row):
    cgroup = row.get('cgroup', {}); host = memory_bytes(row.get('hostMeminfo'))
    process = memory_bytes('\n'.join(key + ': ' + value for key, value in row.get('processMemory', {}).items()))
    return {'at': row['at'], 'time': epoch(row['at']), 'cpu': counters(cgroup.get('cpu.stat')),
      'memory': counters(cgroup.get('memory.stat')), 'events': counters(cgroup.get('memory.events')),
      'current': number(cgroup.get('memory.current')), 'swap': number(cgroup.get('memory.swap.current')),
      'lifetimePeak': number(cgroup.get('memory.peak')), 'memoryLimit': number(cgroup.get('memory.max')),
      'cpuLimit': cgroup.get('cpu.max'), 'io': io_devices(cgroup.get('io.stat')), 'process': process,
      'pressure': {name: pressure(cgroup.get(name + '.pressure')) for name in ['cpu', 'memory', 'io']},
      'host': host, 'hostPressure': {name: pressure(row.get('hostPressure', {}).get(name)) for name in ['cpu', 'memory', 'io']}}


def summarize_pressure(rows, accessor, seconds):
    result = {}
    for kind in ['cpu', 'memory', 'io']:
        result[kind] = {}
        for level in ['some', 'full']:
            values = [accessor(row).get(kind, {}).get(level, {}) for row in rows]
            change = delta([value.get('total') for value in values])
            result[kind][level] = {'totalMicroseconds': change,
              'fractionOfObservedWallTime': change['delta'] / 1e6 / seconds if change['valid'] and seconds > 0 else None,
              'avg10Percent': gauge([value.get('avg10') for value in values])}
    return result


def summarize_phase(observations, phase):
    start, end = epoch(phase['startedAt']), epoch(phase['endedAt'])
    if end < start: raise ValueError('Negative phase interval')
    rows = [row for row in observations if start <= row['time'] <= end]
    seconds = rows[-1]['time'] - rows[0]['time'] if len(rows) >= 2 else 0
    span = end - start
    window = {'requestedStart': phase['startedAt'], 'requestedEnd': phase['endedAt'], 'phaseComplete': phase['complete'],
      'samples': len(rows), 'firstObservedAt': rows[0]['at'] if rows else None, 'lastObservedAt': rows[-1]['at'] if rows else None,
      'observedSeconds': seconds, 'requestedSeconds': span,
      'unobservedStartSeconds': rows[0]['time'] - start if rows else span,
      'unobservedEndSeconds': end - rows[-1]['time'] if rows else span,
      'fractionCoveredByCounterWindow': seconds / span if span else None,
      'maximumSampleGapSeconds': max((right['time'] - left['time'] for left, right in zip(rows, rows[1:])), default=None)}
    cpu = {key: delta([row['cpu'].get(key) for row in rows]) for key in ['usage_usec', 'user_usec', 'system_usec', 'nr_periods', 'nr_throttled', 'throttled_usec']}
    quotas = sorted({row['cpuLimit'] for row in rows if isinstance(row['cpuLimit'], str)})
    cores = None
    if len(quotas) == 1:
        parts = quotas[0].split()
        if len(parts) == 2 and number(parts[0]) is not None and number(parts[1]) not in [None, 0]: cores = float(parts[0]) / float(parts[1])
    usage = cpu['usage_usec']['delta']
    cpu.update(meanCores=usage / 1e6 / seconds if usage is not None and seconds > 0 else None, quotaCores=cores,
      meanFractionOfQuota=usage / 1e6 / seconds / cores if usage is not None and seconds > 0 and cores else None,
      quotaValues=quotas,
      throttledPeriodFraction=cpu['nr_throttled']['delta'] / cpu['nr_periods']['delta'] if cpu['nr_throttled']['valid'] and cpu['nr_periods']['valid'] and cpu['nr_periods']['delta'] else None)
    memory = {name: gauge([row[key] for row in rows]) for name, key in [('memoryChargeBytes', 'current'), ('swapChargeBytes', 'swap'), ('cgroupLifetimePeakBytes', 'lifetimePeak'), ('limitBytes', 'memoryLimit')]}
    for key in ['anon', 'file', 'kernel', 'file_mapped', 'file_dirty', 'file_writeback', 'shmem', 'swapcached']:
        memory[key + 'Bytes'] = gauge([row['memory'].get(key) for row in rows])
    memory['events'] = {key: delta([row['events'].get(key) for row in rows]) for key in sorted({key for row in rows for key in row['events']})}
    memory['activityCounters'] = {key: delta([row['memory'].get(key) for row in rows]) for key in ['pgfault', 'pgmajfault', 'pgscan', 'pgsteal', 'pswpin', 'pswpout', 'workingset_refault_anon', 'workingset_refault_file']}
    io = {device: {key: delta([row['io'].get(device, {}).get(key) for row in rows]) for key in ['rbytes', 'wbytes', 'rios', 'wios', 'dbytes', 'dios']}
      for device in sorted({device for row in rows for device in row['io']})}
    return {'id': phase['id'], 'kind': phase['kind'], 'interval': window, 'cgroupCpu': cpu, 'cgroupMemory': memory,
      'cgroupIoByDevice': io, 'cgroupPressure': summarize_pressure(rows, lambda row: row['pressure'], seconds),
      'observedEntrypointProcessMemory': {key: gauge([row['process'].get(key) for row in rows]) for key in ['VmRSS', 'VmHWM', 'RssAnon', 'RssFile', 'VmSwap']},
      'hostMemoryBytes': {key: gauge([row['host'].get(key) for row in rows]) for key in ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree']},
      'hostPressure': summarize_pressure(rows, lambda row: row['hostPressure'], seconds)}


def campaign_phase(campaign, phase_id, captured_at):
    interruption = campaign.get('interruption') or {}
    return {'id': phase_id, 'kind': campaign.get('experiment', 'campaign'), 'startedAt': campaign['startedAt'],
      'endedAt': campaign.get('finishedAt') or interruption.get('at') or captured_at,
      'complete': bool(campaign.get('finishedAt')) and not campaign.get('error') and not interruption}


def summarize_benchmark_profile(profile, observations, campaign_kind):
    before, after = profile.get('before'), profile.get('after')
    raw_samples = list(profile.get('samples', []))
    for bracket in [before, after]:
        if bracket is not None and bracket not in raw_samples: raw_samples.append(bracket)
    failed_reads = [sample for sample in raw_samples if isinstance(sample, dict) and sample.get('error')]
    malformed_reads = [sample for sample in raw_samples if not isinstance(sample, dict) or
      (not sample.get('error') and (not sample.get('at') or not sample.get('nodes')))]
    reported_errors = profile.get('resourceErrors')
    errors = max(len(failed_reads), reported_errors or 0)
    missing_brackets = sum(not isinstance(sample, dict) or not sample.get('at') or not sample.get('nodes') for sample in [before, after])
    sample_evidence = {'failedReads': len(failed_reads), 'missingOrMalformedReads': len(malformed_reads),
      'missingBrackets': missing_brackets, 'reportedResourceErrors': reported_errors,
      'errors': [sample['error'] for sample in failed_reads],
      'complete': not errors and not malformed_reads and not missing_brackets}
    result = {'candidateId': profile.get('candidateId'), 'method': profile.get('method'), 'queryId': profile.get('queryId'),
      'selectivity': profile.get('selectivity'), 'concurrency': profile.get('concurrency'), 'arrivalRate': profile.get('rate'),
      'viableAtTestedLoad': profile.get('viableAtTestedLoad'), 'requests': len(profile.get('trials', [])),
      'resourceSampleErrors': errors, 'resourceSampleEvidence': sample_evidence,
      'measurement': 'Resource-bracket observations include load-generator instrumentation and any simultaneous node background work.'}
    if missing_brackets: return {**result, 'available': False, 'reason': 'Missing resource bracket'}
    samples = [sample for sample in raw_samples if isinstance(sample, dict) and not sample.get('error')]
    # before/after may also appear in samples; duplicate timestamps are not new observations.
    samples = list({sample['at']: sample for sample in samples if sample.get('at') and sample.get('nodes')}.values())
    samples.sort(key=lambda sample: epoch(sample['at']))
    seconds = epoch(after['at']) - epoch(before['at'])
    node_ids = [set(sample['nodes']) for sample in samples]
    stable_nodes = bool(node_ids) and all(ids == node_ids[0] for ids in node_ids)
    def node_sum(sample, *keys):
        values = []
        for node in sample['nodes'].values():
            value = node
            for key in keys: value = value.get(key, {}) if isinstance(value, dict) else None
            if not isinstance(value, (int, float)): return None
            values.append(value)
        return sum(values)
    def node_delta(*keys):
        change = delta([node_sum(sample, *keys) for sample in samples])
        if not stable_nodes: change.update(delta=None, valid=False, reason='Node identity changed')
        elif not sample_evidence['complete']: change.update(delta=None, valid=False, reason='Resource collection incomplete')
        return change
    cpu = node_delta('process', 'cpu', 'total_in_millis')
    client_cpu = delta([sample.get('clientCpu', {}).get('user', 0) + sample.get('clientCpu', {}).get('system', 0) if sample.get('clientCpu') else None for sample in samples])
    node = {'identityStable': stable_nodes, 'resourceBracketSeconds': seconds, 'processCpuMilliseconds': cpu,
      'meanProcessCpuCores': cpu['delta'] / 1000 / seconds if cpu['valid'] and stable_nodes and seconds > 0 else None,
      'heapUsedBytes': gauge([node_sum(sample, 'jvm', 'mem', 'heap_used_in_bytes') for sample in samples]),
      'heapMaxBytes': gauge([node_sum(sample, 'jvm', 'mem', 'heap_max_in_bytes') for sample in samples]),
      'nonHeapUsedBytes': gauge([node_sum(sample, 'jvm', 'mem', 'non_heap_used_in_bytes') for sample in samples]),
      'residentMemoryBytes': None,
      'virtualAddressSpaceBytes': gauge([node_sum(sample, 'process', 'mem', 'total_virtual_in_bytes') for sample in samples]),
      'searchRejections': node_delta('thread_pool', 'search', 'rejected'),
      'searchQueue': gauge([node_sum(sample, 'thread_pool', 'search', 'queue') for sample in samples]),
      'activeMerges': gauge([node_sum(sample, 'indices', 'merges', 'current') for sample in samples])}
    node['gc'] = {collector: {key: node_delta('jvm', 'gc', 'collectors', collector, key) for key in ['collection_count', 'collection_time_in_millis']}
      for collector in sorted({key for sample in samples for n in sample['nodes'].values() for key in n.get('jvm', {}).get('gc', {}).get('collectors', {})})}
    result.update(available=True, node=node, loadGenerator={'cpuMicroseconds': client_cpu,
      'meanCpuCores': client_cpu['delta'] / 1e6 / seconds if client_cpu['valid'] and seconds > 0 else None,
      'rssBytes': gauge([sample.get('clientMemory', {}).get('rss') for sample in samples]),
      'heapUsedBytes': gauge([sample.get('clientMemory', {}).get('heapUsed') for sample in samples])},
      kernel=summarize_phase(observations, {'id': profile.get('id') or str(profile.get('candidateId')) + ':rate' + str(profile.get('rate')),
        'kind': campaign_kind + '-profile', 'startedAt': before['at'], 'endedAt': after['at'], 'complete': True}))
    return result


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--observer', type=Path, required=True); parser.add_argument('--build-status', type=Path, required=True)
    parser.add_argument('--campaign', type=Path, action='append', default=[]); parser.add_argument('--directory', type=Path, required=True); args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=False)
    captured_at = now()
    source = Path(__file__).read_bytes(); (args.directory / 'summary-source.py').write_bytes(source)
    rawmeta = (args.observer / 'observer.json').read_bytes(); metadata = json.loads(rawmeta)
    observer_source = (args.observer / 'observer-source.py').read_bytes()
    if sha(observer_source) != metadata['sourceSha256']: raise ValueError('Observer source hash differs')
    rows, prefix, inventory = read_complete_jsonl(args.observer / 'resources.jsonl')
    if not rows: raise ValueError('Observer has no complete observations')
    observations = [normalize_observation(row) for row in rows]
    with gzip.open(args.directory / 'observer-prefix.jsonl.gz', 'wb', compresslevel=1) as out: out.write(prefix)
    (args.directory / 'observer.json').write_bytes(rawmeta); (args.directory / 'observer-source.py').write_bytes(observer_source)
    statusbytes = args.build_status.read_bytes(); status = json.loads(statusbytes); (args.directory / 'build-status.json').write_bytes(statusbytes)
    phases = []
    for row in status['phases']:
        if row['id'] != 'points-full-1m-index': continue
        phases.append(summarize_phase(observations, {'id': row['id'], 'kind': 'indexing', 'startedAt': row['startedAt'],
          'endedAt': row.get('finishedAt') or captured_at, 'complete': bool(row.get('finishedAt')) and row.get('exitCode') == 0}))
    campaigns, campaign_inputs = [], []
    for filename in args.campaign:
        raw = filename.read_bytes(); campaign = json.loads(raw)
        if campaign.get('experiment') not in ['favorite-optimization-benchmark', 'favorite-optimization-arrival']: raise ValueError('Unknown campaign')
        descriptor = campaign_phase(campaign, filename.parent.name, captured_at)
        complete = descriptor['complete']
        phase = summarize_phase(observations, descriptor)
        candidates = {candidate['id']: candidate for candidate in campaign.get('candidates', campaign.get('selection', {}).get('selected', []))}
        profiles = [summarize_benchmark_profile({**profile, 'method': profile.get('method') or candidates.get(profile.get('candidateId'), {}).get('method')}, observations, campaign['experiment']) for profile in campaign.get('profiles', [])]
        campaigns.append({'artifact': str(filename), 'sha256': sha(raw), 'complete': complete, 'phase': phase, 'profiles': profiles})
        campaign_inputs.append({'artifact': str(filename), 'sha256': sha(raw), 'profiles': [{key: value for key, value in profile.items() if key in ['id', 'candidateId', 'method', 'queryId', 'selectivity', 'concurrency', 'rate', 'viableAtTestedLoad', 'before', 'after', 'samples', 'resourceErrors']} for profile in campaign.get('profiles', [])]})
    (args.directory / 'campaign-resource-inputs.json').write_text(json.dumps(campaign_inputs))
    report = {'schemaVersion': 1, 'experiment': 'favorite-resource-attribution', 'generatedAt': now(), 'fileOnly': True,
      'sourceSha256': sha(source), 'observer': {**inventory, 'metadataSha256': sha(rawmeta), 'sourceSha256': metadata['sourceSha256'], 'observedPid': metadata['pid'], 'cgroup': metadata['cgroup'], 'intervalSeconds': metadata['intervalSeconds']},
      'buildStatus': {'path': str(args.build_status), 'sha256': sha(statusbytes)}, 'indexing': phases, 'campaigns': campaigns,
      'limitations': [
        'Cgroup observations include all processes in the OpenSearch container, indexing, merges and background work. Phase boundaries provide temporal attribution, not a causal allocation to one method.',
        'memory.current is the cgroup memory charge; anon is not JVM heap, and file is filesystem cache including mapped pages. file_mapped/dirty/writeback are subsets, not additive categories. Swap is reported separately.',
        'The observed /proc PID is the container entrypoint, not the JVM. Its RSS and lifetime VmHWM do not measure OpenSearch resident memory. JVM resident memory is unavailable in these saved node stats.',
        'memory.peak is a cgroup lifetime peak, not a phase peak. All phase maxima are sampled maxima; sub-sample spikes can be missed.',
        'IO stays per device. Layered device counters can describe the same IO and must not be summed as independent traffic.',
        'CPU usage deltas give mean cores within the observed counter window. Throttling/pressure counters are reported separately, not treated as extra CPU usage.',
        'JVM heap/GC and load-generator CPU/RSS are available only where saved benchmark resource brackets exist. Indexing has no continuously sampled JVM heap or encoder-client memory in this observer.',
        'Load-generator CPU/RSS includes query orchestration, response processing, metrics and evidence writing. It is not an isolated production gateway/service measurement.',
        'Only samples inside each phase are used. Boundary gaps, missing samples and counter resets are explicit. No extrapolation fills unobserved intervals.',
        'Host pressure/memory include unrelated applications and other containers. They identify possible contention, not its cause.',
        'Root verified the live resources-v3 invocation uses --max-seconds43200 (12h), beginning13:27UTC; expected duration limit about01:27UTC next day. Archived observer metadata does not record this argument; source default21600 is not the actual invocation.',
      ]}
    (args.directory / 'resources-summary.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'directory': str(args.directory), 'observerSamples': len(rows), 'indexingPhases': len(phases), 'campaigns': len(campaigns)}))


if __name__ == '__main__': main()
