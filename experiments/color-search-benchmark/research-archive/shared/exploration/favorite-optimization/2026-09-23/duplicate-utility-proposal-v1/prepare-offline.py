import difflib, hashlib, json, pathlib, re

directory = pathlib.Path(__file__).resolve().parent
source = pathlib.Path('/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration')
names = ['favorite-multiplicity-utilities.mjs', 'favorite-multiplicity-utilities.test.mjs']
staging = directory / 'offline-staging'
staging.mkdir(exist_ok=True)
snapshots = {}
def collect(file):
    key = str(file)
    if key in snapshots: return
    text = file.read_text()
    snapshots[key] = hashlib.sha256(text.encode()).hexdigest()
    for match in re.finditer(r'''(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]''',text):
        target=(file.parent/match[1]).resolve()
        if not target.exists(): target=(source/match[1]).resolve()
        if target.suffix in ['.mjs','.js','.json']: collect(target)

patch = []
for name in names:
    text = (directory/name).read_text()
    collect(directory/name)
    def rewrite(match):
        relative=match[1]
        if pathlib.Path(relative).name in names: return match[0]
        return match[0].replace(relative,(source/relative).resolve().as_uri())
    staged = re.sub(r'''from\s*['"](\.[^'"]+)['"]''',rewrite,text)
    (staging/name).write_text(staged)
    patch.extend(difflib.unified_diff([],text.splitlines(keepends=True),fromfile='/dev/null',tofile='b/experiments/color-search-benchmark/exploration/'+name))
(directory/'multiplicity-new-files.patch').write_text(''.join(patch))
(directory/'source-hashes.json').write_text(json.dumps(snapshots,indent=2))
print(json.dumps({'externalStaging':str(staging),'sourceFiles':len(snapshots),'worktreeChanges':False,'serviceRequests':False}))
