import { mkdtemp, writeFile, chmod, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
export async function protocol() {
  const directory = await mkdtemp(join(tmpdir(), 'factory-protocol-'));
  const repository = join(directory, 'repo');
  execFileSync('git', ['init', repository]);
  execFileSync('git', [
    '-C',
    repository,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '-m',
    'base',
  ]);
  const base = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const configFile = join(directory, 'config.json');
  const config = { directory, repository, lost: true };
  await writeFile(configFile, JSON.stringify(config));
  for (const name of ['gh', 't3']) {
    await copyFile(resolve('test/fixtures/protocol.mjs'), join(directory, name));
    await chmod(join(directory, name), 0o700);
  }
  return {
    directory,
    repository,
    base,
    configFile,
    config,
    binary: join(directory, 't3'),
    save: async (patch: object) => writeFile(configFile, JSON.stringify({ ...config, ...patch })),
    calls: async () =>
      (await readFile(join(directory, 'calls.jsonl'), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
