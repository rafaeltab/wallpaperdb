"""Read-only preview evidence. No signalling, Make, or retirement claims."""

from pathlib import Path
import json
import os
import sys


def identity(pid):
    stat = Path('/proc/'+str(pid)+'/stat')
    try:
        text = stat.read_text()
    except FileNotFoundError:
        return None
    fields = text.rpartition(') ')[2].split()
    current = {'pid': pid, 'state': fields[0], 'parentPid': int(fields[1]),
               'group': int(fields[2]), 'session': int(fields[3]),
               'startTicks': fields[19], 'cwd': None}
    if current['state'] != 'Z':
        try:
            current['cwd'] = os.readlink('/proc/'+str(pid)+'/cwd')
        except FileNotFoundError:
            try:
                after = stat.read_text().rpartition(') ')[2].split()
            except FileNotFoundError:
                return None
            if after[0] == 'Z' and after[19] == current['startTicks']:
                current['state'] = 'Z'
                return current
            raise
    return current


def matching(current, recorded, root, live):
    if current is None:
        raise ValueError('Required current preview/dev owner is absent')
    for key in ['pid', 'startTicks', 'group', 'session']:
        if key in recorded and current[key] != recorded[key]:
            raise ValueError('Current process identity differs: '+key)
    if recorded.get('cwd', str(root)) != str(root):
        raise ValueError('Recorded process cwd differs from owning root')
    if live and (current['state'] == 'Z' or current['cwd'] != str(root)):
        raise ValueError('Required current owner is not live in owning root')
    return current


def snapshot(old, launch, root, ports):
    dev_record = {**launch, 'startTicks': launch['birth']}
    controller = matching(identity(old['pid']), old, root, True)
    forward = matching(identity(old['forward']['pid']), old['forward'], root, True)
    dev = matching(identity(launch['pid']), dev_record, root, True)
    identities = {row['pid']: row for row in [controller, forward]}
    observed = []
    for recorded in old['captured']:
        current = identity(recorded['pid'])
        status = 'absent' if current is None else 'zombie' if current['state'] == 'Z' else 'live'
        if current is not None:
            matching(current, recorded, root, status == 'live')
            if status == 'live':
                identities[current['pid']] = current
        observed.append({'recorded': recorded, 'current': current, 'status': status})
    listeners = []
    for table in ['/proc/net/tcp', '/proc/net/tcp6']:
        for line in Path(table).read_text().splitlines()[1:]:
            cols = line.split()
            port = int(cols[1].split(':')[1], 16)
            if cols[3] != '0A' or port not in ports:
                continue
            row = {'table': table, 'local': cols[1], 'port': port,
                   'inode': cols[9], 'owners': []}
            for current in identities.values():
                try:
                    descriptors = list(Path('/proc/'+str(current['pid'])+'/fd').iterdir())
                except FileNotFoundError:
                    # A captured process can retire between these observations.
                    # The mandatory current owners are revalidated below.
                    continue
                for descriptor in descriptors:
                    try:
                        target = os.readlink(descriptor)
                    except FileNotFoundError:
                        continue
                    if target == 'socket:['+row['inode']+']':
                        fresh = identity(current['pid'])
                        if fresh is None or fresh['state'] == 'Z':
                            continue
                        matching(fresh, current, root, True)
                        row['owners'].append({'identity': fresh, 'fd': descriptor.name})
            if not row['owners']:
                raise ValueError('Selected listener has no exact observed owner')
            listeners.append(row)
    if {row['port'] for row in listeners} != set(ports):
        raise ValueError('Both selected preview listeners must be observed')
    matching(identity(old['pid']), old, root, True)
    matching(identity(old['forward']['pid']), old['forward'], root, True)
    matching(identity(launch['pid']), dev_record, root, True)
    return {'identities': list(identities.values()), 'dev': dev, 'listeners': listeners,
            'capturedObservations': observed,
            'scope': 'Read-only observations, not signalling authority or retirement proof'}


if __name__ == '__main__':
    supplied = json.loads(Path(sys.argv[1]).read_text())
    value = snapshot(supplied['oldPreview'], supplied['devLauncher'],
                     Path(supplied['root']), supplied['ports'])
    print('BOAT547_PREVIEW_OBSERVATION '+json.dumps(value))
