import { mkdtemp, writeFile, chmod, copyFile, readFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runProtocol } from './protocol.mjs';
export async function protocol() {
  const directory = await mkdtemp(join(tmpdir(), 'factory-protocol-'));
  const repository = join(directory, 'repo');
  execFileSync('git', ['init', '--initial-branch=main', repository]);
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
    readGitHub: async (args: string[], signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const output: string[] = [];
      const errors: string[] = [];
      const code = await runProtocol(
        { FACTORY_FIXTURE: configFile },
        [process.execPath, 'gh', ...args],
        { log: (text: string) => output.push(text), error: (text: string) => errors.push(text) },
        signal
      );
      signal?.throwIfAborted();
      if (code !== 0)
        throw new Error(`Controlled GitHub protocol exited ${code}: ${errors.join('\n')}`);
      return JSON.parse(output.join('\n'));
    },
    save: async (patch: object) => {
      const next = `${configFile}.next`;
      await writeFile(next, JSON.stringify({ ...config, ...patch }));
      await rename(next, configFile);
    },
    calls: async () =>
      (await readFile(join(directory, 'calls.jsonl'), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
