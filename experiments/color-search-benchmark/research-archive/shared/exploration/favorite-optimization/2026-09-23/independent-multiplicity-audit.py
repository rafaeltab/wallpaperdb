"""File-only arithmetic and feedback audit; imports no prototype/evaluator code."""
import collections
import datetime
import hashlib
import importlib.util
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).parent
REPO = Path('/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark')
spec = importlib.util.spec_from_file_location('independent_feedback', ROOT / 'independent-feedback-audit.py')
feedback_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feedback_audit)
errors = []

def check(condition, message):
    if not condition: errors.append(message)

def sha(raw): return hashlib.sha256(raw).hexdigest()
def encode(value): return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
def load(directory, name): return json.loads((directory / name).read_bytes())
def lines(directory, name): return [json.loads(line) for line in (directory / name).read_text().splitlines()]
def f32(value): return struct.unpack('!f', struct.pack('!f', value))[0]
def key(parameters): return (parameters['qualityInfluence'], parameters['cutoffBlendExponent'])
def raw_hits(trace):
    response = trace['response'].get('body', trace['response'])
    check(not response.get('timed_out') and not response.get('_shards', {}).get('failed'), 'Partial service response')
    hits = response['hits']['hits']
    result = []
    for hit in hits:
        check(len(hit.get('fields', {}).get('id', [])) == 1, 'Missing/ambiguous ID doc value')
        result.append({'id': hit['fields']['id'][0], 'score': hit['_score']})
    check(len({hit['id'] for hit in result}) == len(result), 'Duplicate response ID')
    return result

def compare_hits(actual, expected, label, exact_transport=False):
    check(len(actual) == len(expected), label + ': count')
    check([h['id'] for h in actual] == [h['id'] for h in expected], label + ': IDs/order')
    check(all((a['score'] == b['score'] if exact_transport else f32(a['score']) == f32(b['score'])) for a, b in zip(actual, expected)), label + ': scores')

def source_check(directory, summary):
    archive = load(directory, 'source-snapshot.json')
    check(sha(encode(archive)) == summary['sourceSnapshotHash'], directory.name + ': source archive hash')
    for filename, source in archive.items():
        check((REPO / filename).read_text() == source, directory.name + ': current source differs ' + filename)
    return {'files': len(archive), 'hash': summary['sourceSnapshotHash']}

def fidelity():
    directory = ROOT / 'multiplicity-fidelity-v1'
    summary = load(directory, 'fidelity.json')
    traces = lines(directory, 'service-traces.jsonl')
    check(summary.get('passed') is True and summary.get('finishedAt'), 'Fidelity incomplete')
    sources = source_check(directory, summary)
    before, after = load(directory, 'index-before.json'), load(directory, 'index-after.json')
    check(before['generation'] == after['generation'], 'Fidelity index generation changed')
    check(before['count'] == 545 and before['mapping']['properties']['id']['type'] == 'keyword', 'Index count/ID mapping')
    check(before['mapping']['_meta']['utilityDefinitionVersion'] == 2, 'Utility definition changed')
    by_phase = collections.defaultdict(list)
    for trace in traces:
        check(not trace.get('error'), 'Trace service error')
        by_phase[trace['context']['phase']].append(trace)
    check(len(by_phase['doc-values']) == 9, 'Nine preset doc-value reads required')
    values, ids = {}, None
    for trace in by_phase['doc-values']:
        preset = key(trace['context']['parameters'])
        body = trace['response']['body']
        check(body['hits']['total'] == {'value': 545, 'relation': 'eq'}, 'Doc-value response must be complete')
        check(not body.get('timed_out') and body['_shards']['failed'] == 0, 'Partial doc-value response')
        rows = body['hits']['hits']
        current_ids = [row['fields']['id'][0] for row in rows]
        check(len(current_ids) == len(set(current_ids)) == 545 and current_ids == sorted(current_ids), 'Doc-value IDs invalid')
        if ids is None: ids = current_ids
        check(ids == current_ids, 'Preset corpus changed')
        fields = trace['request']['body']['docvalue_fields'][1:]
        for field in fields:
            check(before['mapping']['properties']['utilities']['properties'][field.removeprefix('utilities.')]['type'] == 'float', 'Utility is not float')
        values[preset] = {row['fields']['id'][0]: {field: f32(row['fields'][field][0]) for field in fields} for row in rows}
    check(set(values) == {(q, w) for q in [0, .5, 1] for w in [0, 1, 3]}, 'Preset grid incomplete')
    # The index's established red and blue anchors are r0004/r0001. This audit
    # verifies the duplicate-weight rewrite, not prior image extraction/binning.
    recipes = {
      'red-red': [('r0004', 'p050'), ('r0004', 'p050')],
      'red-nearby-red': [('r0004', 'p050'), ('r0004', 'p050')],
      'red-red-blue': [('r0004', 'p020'), ('r0004', 'p020'), ('r0001', 'p020')],
      'red-nearby-red-blue': [('r0004', 'p020'), ('r0004', 'p020'), ('r0001', 'p020')],
      'red-different-amounts': [('r0004', 'p020'), ('r0004', 'p040')],
      'red-red-vibe': [('r0004', 'v'), ('r0004', 'v')],
    }
    expected, max_ideal_error = {}, 0
    for preset, documents in values.items():
        q, w = preset
        for query_id, recipe in recipes.items():
            requested = [f'utilities.{anchor}_{amount}_q{round(q * 100):03d}_w{w}' for anchor, amount in recipe]
            multiplicities = collections.Counter(requested)
            hits = []
            for id, fields in documents.items():
                score = f32(sum(f32(fields[field] * f32(count / len(requested))) for field, count in multiplicities.items()))
                ideal = sum(fields[field] for field in requested) / len(requested)
                max_ideal_error = max(max_ideal_error, abs(score - ideal))
                hits.append({'id': id, 'score': score})
            expected[(preset, query_id)] = (sorted(hits, key=lambda hit: (-hit['score'], hit['id'])), multiplicities, len(requested))
    oracle_rows = lines(directory, 'oracles.jsonl')
    check(len(oracle_rows) == 54, 'Expected54 independent oracle records')
    for row in oracle_rows:
        compare_hits(row['hits'], expected[(key(row['parameters']), row['queryId'])][0], 'Saved oracle')
    corrected_seen, corrected_documents, changed_executions = set(), 0, 0
    for trace in by_phase['corrected']:
        context, body = trace['context'], trace['request']['body']
        identity = (key(context['parameters']), context['queryId'], context['limit'])
        check(identity not in corrected_seen, 'Repeated corrected execution'); corrected_seen.add(identity)
        hits, multiplicities, count = expected[identity[:2]]
        should = body['query']['bool']['should']
        clauses = [term['function_score']['field_value_factor'] for term in should]
        check(len(clauses) == len(multiplicities), 'Wrong unique clause count')
        check({term['field']: term['factor'] for term in clauses} == {field: times / count for field, times in multiplicities.items()}, 'Wrong grouped weights')
        check(body['sort'] == [{'_score': 'desc'}, {'id': 'asc'}], 'Scoring/tie order changed')
        check(body.get('_source') is False and body.get('stored_fields') == '_none_' and body.get('docvalue_fields') == ['id'], 'Lean ID fetch changed')
        check(body['query']['bool']['filter'] == [{'match_all': {}}], 'Unexpected limited candidate filtering')
        actual = raw_hits(trace); compare_hits(actual, hits[:context['limit']], 'Corrected native result')
        corrected_documents += len(actual); changed_executions += len(multiplicities) < count
    check(corrected_seen == {(preset, query_id, limit) for preset in values for query_id in recipes for limit in [1000, 20, 1]}, 'Corrected case/preset/limit grid differs')
    parent_groups = collections.defaultdict(list)
    for trace in by_phase['distinct-parent']:
        parent_groups[(key(trace['context']['parameters']), trace['context']['queryId'])].append(trace)
    check(len(parent_groups) == 144, 'Expected144 ordinary query/preset comparisons')
    for identity, pair in parent_groups.items():
        check(len(pair) == 2, 'Ordinary comparison lacks two service results')
        check(pair[0]['request'] == pair[1]['request'], 'Ordinary request changed')
        compare_hits(raw_hits(pair[0]), raw_hits(pair[1]), 'Ordinary parent parity', True)
        check(sorted(hit['id'] for hit in raw_hits(pair[0])) == ids, 'Ordinary comparison lacks full545')
    equivalence_count = 0
    for phase in ['single-equivalent', 'unchanged-parent']:
        for trace in by_phase[phase]:
            identity = (key(trace['context']['parameters']), trace['context']['queryId'])
            compare_hits(raw_hits(trace), expected[identity][0], 'Single/control equivalence'); equivalence_count += 1
    filtered = by_phase['filtered-duplicates']
    check(len(filtered) == 6, 'Expectedthree filtered service comparisons')
    for start in range(0, len(filtered), 2):
        left, right = filtered[start:start+2]
        compare_hits(raw_hits(left), raw_hits(right), 'Filtered duplicate equivalence', True)
        eligibility = left['context']['eligibility']; actual_ids = [hit['id'] for hit in raw_hits(left)]
        allowed = set(eligibility.get('eligibleIds', ids)) - set(eligibility.get('excludedIds', []))
        check(set(actual_ids) == allowed, 'Filtered eligible IDs differ')
    check(summary['correctedExecutions'] == len(corrected_seen) == 162 and summary['distinctParentComparisons'] == len(parent_groups), 'Summary execution counts differ')
    check(max_ideal_error <= 3e-7, 'Ideal repeated-term mean drift exceeds bound')
    return {'directory': str(directory), 'sources': sources, 'indexUuid': before['uuid'], 'corpusSize': 545,
      'duplicateSuiteExecutions': 162, 'actualDuplicateWeightCorrections': changed_executions,
      'sameAnchorDifferentAmountUnchangedControls': 162 - changed_executions,
      'duplicateSuiteDocumentComparisons': corrected_documents,
      'ordinaryParentComparisons': 144, 'ordinaryParentDocumentComparisons': 144 * 545,
      'singleEquivalentOrUnchangedFullComparisons': equivalence_count,
      'filteredComparisons': 3, 'maxIdealRepeatedMeanError': max_ideal_error,
      'serviceTraceCount': len(traces), 'rawFiles': {name: sha((directory / name).read_bytes()) for name in ['fidelity.json', 'service-traces.jsonl', 'oracles.jsonl', 'index-before.json', 'index-after.json']}}

def feedback():
    directory = ROOT / 'multiplicity-feedback-v1'
    summary, dataset, corpus = [load(directory, name) for name in ['feedback.json', 'dataset.json', 'corpus.json']]
    check(summary.get('passed') is True and summary.get('finishedAt'), 'Feedback incomplete')
    sources = source_check(directory, summary)
    check(sha(encode({k: v for k, v in dataset.items() if k != 'accuracyPolicy'})) == summary['datasetHash'], 'Feedback dataset hash differs')
    check(load(directory, 'index-before.json') == load(directory, 'index-after.json'), 'Feedback index generation changed')
    cases = {row['id']: row for row in dataset['cases']}; corpus_ids = {row['id'] for row in corpus}
    check(len(corpus) == len(corpus_ids) == 545, 'Feedback corpus inventory differs')
    for case in cases.values():
        derived = [(left, right) for i, group in enumerate(case['orderGroups']) for left in group for following in case['orderGroups'][i+1:] for right in following]
        check(derived == [(pair['preferred'], pair['other']) for pair in case['preferencePairs']], 'Feedback pairs not derived from original groups')
    traces = lines(directory, 'service-traces.jsonl'); case_rows = lines(directory, 'cases.jsonl')
    candidates = []
    for candidate in summary['candidates']:
        check([row['caseId'] for row in candidate['cases']] == list(cases), 'Feedback case inventory changed')
        saved = [row for row in case_rows if row['candidate'] == candidate['id']]
        captured = [row for row in traces if row['candidate'] == candidate['id']]
        ok = [row for row in candidate['cases'] if row['status'] == 'ok']
        check(len(saved) == len(captured) == len(ok) == 32, 'Feedback capture count differs')
        records = []
        for row in candidate['cases']:
            check(all(hit['id'] in corpus_ids for hit in row['hits']), 'Unknown corpus hit')
            calculated, comparisons = feedback_audit.accuracy(cases[row['caseId']], row['hits'])
            check(feedback_audit.equivalent(calculated, row['accuracy']), 'Feedback case metric differs: ' + row['caseId'])
            records.append({'status': row['status'], 'accuracy': calculated})
        for row, saved_row, trace in zip(ok, saved, captured):
            check({k: v for k, v in saved_row.items() if k != 'candidate'} == row, 'Saved case capture differs')
            compare_hits(row['hits'], raw_hits(trace), 'Feedback service result', True)
            fields = [term['function_score']['field_value_factor']['field'] for term in trace['request']['body']['query']['bool']['should']]
            check(len(fields) == len(set(fields)), 'Existing feedback unexpectedly contains duplicate utility fields')
            check(not row.get('evidence', {}).get('multiplicity', {}).get('corrected'), 'Existing feedback has changed duplicate objective')
        metrics = feedback_audit.summarize(records)
        categories = list(dict.fromkeys(record['accuracy']['category'] for record in records))
        metrics['categories'] = {category: feedback_audit.summarize([record for record in records if record['accuracy']['category'] == category]) for category in categories}
        check(feedback_audit.equivalent(metrics, candidate['accuracy']), 'Feedback aggregate differs')
        coverage = {'ok': sum(row['status'] == 'ok' for row in records), 'unsupported': sum(row['status'] == 'unsupported' for row in records), 'errors': sum(row['status'] == 'error' for row in records)}
        check(coverage == candidate['coverage'], 'Feedback coverage differs')
        candidates.append({'id': candidate['id'], 'coverage': coverage, 'agreement': metrics['allPairs'], 'withoutUncertain': metrics['withoutUncertain']})
    parent, corrected = summary['candidates']
    check([(row['caseId'], row['status'], row['hits']) for row in parent['cases']] == [(row['caseId'], row['status'], row['hits']) for row in corrected['cases']], 'Feedback parent/corrected outcomes differ')
    check(parent['accuracy'] == corrected['accuracy'], 'Feedback metrics differ')
    return {'directory': str(directory), 'sources': sources, 'datasetHash': summary['datasetHash'], 'candidates': candidates,
      'serviceTraceCount': len(traces), 'existingHumanFeedbackDuplicateCases': 0, 'changedHumanPairOutcomes': 0,
      'rawFiles': {name: sha((directory / name).read_bytes()) for name in ['feedback.json', 'dataset.json', 'corpus.json', 'cases.jsonl', 'service-traces.jsonl']}}

report = {'schemaVersion': 1, 'experiment': 'favorite-multiplicity-independent-audit', 'fileOnly': True,
  'auditedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'fidelity': fidelity(), 'feedback': feedback(),
  'limitations': ['No service calls or image extraction. Arithmetic is reconstructed from saved native doc values and saved full service responses.',
    '162 suite executions include135 actual duplicate rewrites and27 unchanged same-anchor/different-amount controls.144 ordinary comparisons are a separate full-ranking parity check.',
    'Existing human judgments contain no duplicate-target cases. They establish absence of ordinary feedback regression, not user preference for corrected duplicate semantics.',
    'Correctness on545 records (523real+22synthetic), not a capacity/latency claim. Original16 methods and favorite remain preserved.']}
report.update(integrityPassed=not errors, errors=errors, auditCodeSha256=sha(Path(__file__).read_bytes()))
output = ROOT / 'multiplicity-independent-audit-v1.json'
with output.open('x') as f: json.dump(report, f, indent=2); f.write('\n')
print(json.dumps({'report': str(output), 'integrityPassed': report['integrityPassed'], 'errors': errors,
  'fidelity': {k: v for k, v in report['fidelity'].items() if k not in ['rawFiles', 'sources']}, 'feedbackCandidates': report['feedback']['candidates']}, indent=2))
raise SystemExit(0 if report['integrityPassed'] else 1)
