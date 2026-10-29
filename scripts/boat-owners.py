"""Read-only ownership check for the immediate T3 settle fallback, #557.

This is intentionally coupled to the inspected local runtime projection. Unknown
schemas or missing ownership fail closed. It never edits T3 state.
"""
import json
import sqlite3
import sys
from pathlib import Path

workspace, database = sys.argv[1:]
connection = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)
rows = connection.execute('select payload_json from orchestration_v2_projection_threads')
threads = {entry['id']: entry for (payload,) in rows if (entry := json.loads(payload))}
owners = []
def effective_workspace(thread):
    visited = set()
    while thread and thread['id'] not in visited:
        visited.add(thread['id'])
        if thread.get('worktreePath'):
            return thread['worktreePath']
        lineage = thread.get('lineage') or {}
        thread = threads.get(lineage.get('parentThreadId'))
    return None

for thread in threads.values():
    if thread.get('deletedAt'):
        continue
    if effective_workspace(thread) == workspace:
        owners.append(thread)
if not owners:
    raise RuntimeError('No T3 worktree owner found; cleanup refused')
active = [thread['id'] for thread in owners if thread.get('settledOverride') != 'settled']
running = {row[0] for row in connection.execute(
    "select thread_id from orchestration_v2_projection_runs where status in ('preparing','queued','starting','running','waiting')"
)}
active = sorted(set(active) | {thread['id'] for thread in owners if thread['id'] in running})
print(json.dumps({'stop': not active, 'activeOwners': active, 'owners': [t['id'] for t in owners]}))
