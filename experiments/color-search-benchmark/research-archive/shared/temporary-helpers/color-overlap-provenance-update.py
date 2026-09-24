import copy
import hashlib
import json
from pathlib import Path
import urllib.request

root = Path('/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration')
folder = root / 'overlap' / 'bucket-projections'
pairs = [(16, '2850783f095dff935ca1', '901e21f7f39a4df9ac10'), (64, '9ac6faee1f6b9d886f79', '9a1bb54e299af52b656b'), (256, 'b570908325e425cf171e', '0841d63256a57b6ec8e3')]
def api(route, method='GET', body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request('http://127.0.0.1:19216/' + route, data=data, method=method, headers={'content-type': 'application/json'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)

for count, old_suffix, new_suffix in pairs:
    index = f'color-exploration-overlap-{count}-real-v1'
    old_dir, new_dir = folder / f'{count}-{old_suffix}', folder / f'{count}-{new_suffix}'
    old = json.loads((old_dir / 'metadata.json').read_text())
    new = json.loads((new_dir / 'metadata.json').read_text())
    old_identity, new_identity = copy.deepcopy(old['identity']), copy.deepcopy(new['identity'])
    old_identity.pop('sourceHashes'); new_identity.pop('sourceHashes')
    assert old_identity == new_identity, 'Only reporting source identity may change'
    assert old['identity']['sourceHashes']['overlap-banks.mjs'] == new['identity']['sourceHashes']['overlap-banks.mjs']
    old_source = (old_dir / 'sources' / 'overlap-bucket-index.mjs').read_text()
    new_source = (new_dir / 'sources' / 'overlap-bucket-index.mjs').read_text()
    assert old_source.split('if (process.argv[1]')[0] == new_source.split('if (process.argv[1]')[0], 'Projection/index logic must remain byte-identical'
    old_bytes, new_bytes = (old_dir / 'documents.jsonl').read_bytes(), (new_dir / 'documents.jsonl').read_bytes()
    assert old_bytes == new_bytes
    assert hashlib.sha256(new_bytes).hexdigest() == old['projectionHash'] == new['projectionHash']
    expected = {doc['id']: doc for doc in map(json.loads, new_bytes.decode().splitlines())}
    mapping = api(index + '/_mapping')[index]['mappings']
    assert mapping['_meta'] == dict(experiment='overlapping-coverage-quality-buckets', **old)
    actual = api(index + '/_search', 'POST', {'size': len(expected), '_source': True, 'track_total_hits': True, 'sort': [{'id': 'asc'}], 'query': {'match_all': {}}})
    assert not actual.get('timed_out') and not actual['_shards']['failed']
    assert actual['hits']['total']['value'] == len(expected) == 545
    assert {hit['_id']: hit['_source'] for hit in actual['hits']['hits']} == expected
    previous_receipt = json.loads((root / (index + '.json')).read_text())
    desired = dict(experiment='overlapping-coverage-quality-buckets', **new)
    assert api(index + '/_mapping', 'PUT', {'_meta': desired})['acknowledged']
    assert api(index + '/_mapping')[index]['mappings']['_meta'] == desired
    receipt = {'reason': 'CLI summary no longer marks unchanged 1024 ID/fingerprint verification as full projected-value verification.', 'projectionLogicByteIdentical': True, 'all545IndexedSourceValuesVerified': True, 'documentsUnchanged': True, 'oldMetadata': mapping['_meta'], 'newMetadata': desired, 'previousIndexReceipt': previous_receipt}
    (new_dir / 'reporting-source-provenance-update.json').write_text(json.dumps(receipt, indent=2))
    updated_receipt = {**previous_receipt, **new, 'indexMetadata': desired, 'provenanceUpdate': str(new_dir / 'reporting-source-provenance-update.json')}
    (root / (index + '.json')).write_text(json.dumps(updated_receipt, indent=2))
    print(json.dumps({'index': index, 'count': len(expected), 'documentsUnchanged': True, 'directory': str(new_dir)}))
