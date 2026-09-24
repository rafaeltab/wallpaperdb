"""Preserve the stopped real-prototype node before adding a durable data mount.

Never deletes a container, directory, index or source file. Docker's original
container is restarted if copying/verification fails. The separate Make up
target recreates it only after a verified receipt exists.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import urllib.request


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(stream):
    value = hashlib.sha256()
    while block := stream.read(1024 * 1024):
        value.update(block)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--container', required=True)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--receipt-dir', type=Path, required=True)
    args = parser.parse_args()
    if not args.container.endswith('-color-global-opensearch-1'):
        raise ValueError('Only the isolated real-corpus prototype container is allowed')
    container = json.loads(subprocess.check_output(['docker', 'inspect', args.container]))[0]
    ports = container['NetworkSettings']['Ports'].get('9200/tcp', [])
    if not any(p['HostIp'] == '127.0.0.1' and p['HostPort'] == '19216' for p in ports):
        raise ValueError('Expected the isolated loopback19216 service')
    if container['Mounts']:
        raise ValueError('Existing data mounts need a different migration; refusing to replace them')
    args.receipt_dir.mkdir(parents=True, exist_ok=False)
    args.data_dir.mkdir(parents=True, exist_ok=False)
    receipt = {'startedAt': now(), 'containerId': container['Id'], 'containerName': args.container,
               'dataDirectory': str(args.data_dir.resolve()), 'files': [], 'verifiedBytes': 0}

    def save():
        temporary = args.receipt_dir / 'preservation.json.tmp'
        temporary.write_text(json.dumps(receipt, indent=2))
        temporary.replace(args.receipt_dir / 'preservation.json')

    save()
    with urllib.request.urlopen('http://127.0.0.1:19216/_cat/indices?format=json&h=index,uuid,docs.count,status') as response:
        receipt['indexesBefore'] = json.load(response)
    save()
    stopped = False
    try:
        subprocess.run(['docker', 'stop', '--time', '120', args.container], check=True)
        stopped = True
        receipt['stoppedAt'] = now()
        save()
        print(json.dumps({'phase': 'copying-stopped-data', 'at': now()}), flush=True)
        subprocess.run(['docker', 'cp', args.container + ':/usr/share/opensearch/data/.', str(args.data_dir)], check=True)
        receipt['copiedAt'] = now()
        save()
        print(json.dumps({'phase': 'verifying-every-file', 'at': now()}), flush=True)
        # Stream a fresh read of the stopped source. Hash every regular file and
        # independently hash its copied destination; no archive enters memory.
        process = subprocess.Popen(['docker', 'cp', args.container + ':/usr/share/opensearch/data/.', '-'], stdout=subprocess.PIPE)
        seen = set()
        with tarfile.open(fileobj=process.stdout, mode='r|*') as archive:
            for member in archive:
                relative = Path(member.name)
                if relative.is_absolute() or '..' in relative.parts:
                    raise ValueError('Unexpected archive path')
                if member.isdir():
                    continue
                if not member.isfile():
                    raise ValueError('Unexpected nonregular data file: ' + member.name)
                copied = args.data_dir / relative
                source_hash = digest(archive.extractfile(member))
                with copied.open('rb') as stream:
                    copied_hash = digest(stream)
                if copied.stat().st_size != member.size or copied_hash != source_hash:
                    raise ValueError('Copied data differs: ' + member.name)
                name = str(relative)
                if name in seen:
                    raise ValueError('Duplicate archive file')
                seen.add(name)
                receipt['files'].append({'path': name, 'bytes': member.size, 'sha256': source_hash})
                receipt['verifiedBytes'] += member.size
        if process.wait() != 0:
            raise RuntimeError('Source archive verification failed')
        actual = {str(p.relative_to(args.data_dir)) for p in args.data_dir.rglob('*') if p.is_file()}
        if seen != actual:
            raise ValueError('Destination file inventory differs')
        receipt['finishedAt'] = now()
        receipt['verified'] = True
        save()
        print(json.dumps({'phase': 'verified', 'files': len(seen), 'bytes': receipt['verifiedBytes'], 'at': now()}), flush=True)
    except BaseException as error:
        receipt['error'] = repr(error)
        receipt['failedAt'] = now()
        save()
        if stopped:
            subprocess.run(['docker', 'start', args.container], check=True)
        raise


if __name__ == '__main__':
    main()
