import hashlib
import json
import pathlib
import sys

directory = pathlib.Path(sys.argv[1])
repo = pathlib.Path('/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7')
data = json.loads((directory / 'all-cutoff-analysis.json').read_text())
candidates = data['candidates']
source_hashes = candidates[0]['sourceHashes']
assert all(c['sourceHashes'] == source_hashes for c in candidates)
assert 'exploration/cutoff-blend.mjs' in source_hashes
for relative,expected in source_hashes.items():
    source = repo / 'experiments/color-search-benchmark' / relative
    assert hashlib.sha256(source.read_bytes()).hexdigest() == expected, relative
snapshot = data['configuration']['sourceSnapshot']
snapshot_sources = json.loads(pathlib.Path(snapshot['path']).read_text())
assert 'cutoff-blend.mjs' in snapshot_sources
serialized = json.dumps(snapshot_sources,ensure_ascii=False,separators=(',',':')).encode()
assert hashlib.sha256(serialized).hexdigest() == snapshot['sha256']
for relative,expected in source_hashes.items():
    filename = pathlib.Path(relative).name
    if filename.endswith('.mjs'):
        assert hashlib.sha256(snapshot_sources[filename].encode()).hexdigest() == expected, filename
timed = [trial for c in candidates for case in c['cases'] for trial in case['trials']]
assert len(timed) == 4557
assert all(trial['error'] is None for trial in timed)
assert all(0 <= trial['elapsedMs'] < 1000 for trial in timed)
result = {
    'runId':data['runId'], 'candidates':len(candidates),
    'consistentCandidateSourceHashes':True,
    'candidateSourceFilesVerifiedAgainstWorkspace':len(source_hashes),
    'sourceSnapshotHashVerified':True,
    'sourceSnapshotMatchesCandidateQuerySources':True,
    'newBlendHelperCaptured':True,
    'sourceSnapshotSha256':snapshot['sha256'],
    'timedTrials':len(timed), 'timedErrors':0, 'timedAtOrAbove1s':0,
    'maxTimedMs':max(t['elapsedMs'] for t in timed),
}
(directory / 'all-cutoff-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
