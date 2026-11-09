import { mkdtemp, mkdir, writeFile, chmod, readFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runProtocol } from './protocol.js';
import { stripTypeScriptTypes } from 'node:module';
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
  const commands = join(directory, 'commands');
  const fixtureCoverage = join(directory, 'fixture-coverage');
  await mkdir(commands);
  await mkdir(fixtureCoverage);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  // Only controlled fixture programs use this launcher. Application children
  // keep their inherited coverage destination and the stock provider unchanged.
  const nodeCommand = async (
    name: string,
    source: string,
    options: { path?: string; module?: boolean } = {}
  ) => {
    const script = join(commands, `${name}.${options.module ? 'mjs' : 'cjs'}`);
    const executable = options.path ?? join(directory, name);
    await writeFile(script, source);
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(
      executable,
      `#!/bin/sh\nif [ -n "\${NODE_V8_COVERAGE:-}" ]; then\n  export NODE_V8_COVERAGE=${quote(fixtureCoverage)}\nfi\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`
    );
    await chmod(executable, 0o700);
    return executable;
  };
  const source = stripTypeScriptTypes(await readFile(resolve('test/fixtures/protocol.ts'), 'utf8'));
  for (const name of ['gh', 't3']) {
    await nodeCommand(name, source, { module: true });
  }
  return {
    directory,
    repository,
    base,
    configFile,
    config,
    fixtureCoverage,
    nodeCommand,
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
    // Covered fixture processes can finish writing while recursive removal is in progress.
    cleanup: () => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}
