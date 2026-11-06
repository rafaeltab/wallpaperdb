import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { initializeState } from '../src/platform/index.js';
import { protocol } from './fixtures/setup.js';

const run = promisify(execFile);

async function recordedSources(directory: string) {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json'));
  const reports = await Promise.all(
    files.map(async (name) => {
      const report: { result: { url: string }[] } = JSON.parse(
        await readFile(join(directory, name), 'utf8')
      );
      return report.result.map((entry) => entry.url);
    })
  );
  return reports.flat();
}

it('keeps controlled CLI coverage outside the production collector', async () => {
  const host = await protocol();
  const collector = join(host.directory, 'production-coverage');
  const inherited = process.env.NODE_V8_COVERAGE;
  try {
    await mkdir(collector);
    const env = { ...process.env, FACTORY_FIXTURE: host.configFile, NODE_V8_COVERAGE: collector };
    const gh = await run(join(host.directory, 'gh'), ['issue', 'view', '5'], { env });
    expect(JSON.parse(gh.stdout)).toMatchObject({ number: 5, state: 'OPEN' });
    const t3 = await run(host.binary, ['--help'], { env });
    expect(t3.stdout).toContain('--worktree');
    expect(await readdir(collector)).toEqual([]);
    expect(process.env.NODE_V8_COVERAGE).toBe(inherited);
    const fixtureSources = await recordedSources(host.fixtureCoverage);
    expect(fixtureSources.length).toBeGreaterThan(0);
    expect(
      fixtureSources.some((url) => url.startsWith(pathToFileURL(resolve('src') + '/').href))
    ).toBe(false);
    const interrupted = await host.nodeCommand(
      'interrupted',
      `require('node:fs').writeFileSync(require('node:path').join(process.env.NODE_V8_COVERAGE, 'coverage-interrupted.json'), ''); process.kill(process.pid, 'SIGKILL');`
    );
    await expect(run(interrupted, [], { env })).rejects.toMatchObject({ signal: 'SIGKILL' });
    expect(await readFile(join(host.fixtureCoverage, 'coverage-interrupted.json'), 'utf8')).toBe(
      ''
    );
    expect(await readdir(collector)).toEqual([]);
  } finally {
    await host.cleanup();
  }
});

it('preserves literal command paths and arguments through the fixture launcher', async () => {
  const host = await protocol();
  try {
    const command = await host.nodeCommand(
      "quoted ' command",
      'console.log(JSON.stringify(process.argv.slice(2)))'
    );
    const args = ['two words', '$not-expanded', "it's literal"];
    const result = await run(command, args);
    expect(JSON.parse(result.stdout)).toEqual(args);
  } finally {
    await host.cleanup();
  }
});

it.each([undefined, ''])(
  'does not enable caller-disabled fixture coverage, value=%s',
  async (value) => {
    const host = await protocol();
    try {
      const command = await host.nodeCommand(
        'uncovered',
        "console.log(process.env.NODE_V8_COVERAGE ?? 'unset')"
      );
      const result = await run(command, [], { env: { ...process.env, NODE_V8_COVERAGE: value } });
      expect(result.stdout.trim()).toBe(value ?? 'unset');
      expect(await readdir(host.fixtureCoverage)).toEqual([]);
    } finally {
      await host.cleanup();
    }
  }
);

it('retains normal coverage collection for a production-code child', async () => {
  const host = await protocol();
  const collector = join(host.directory, 'production-coverage');
  try {
    initializeState(host.directory);
    await mkdir(collector);
    const child = await run(
      process.execPath,
      ['--import', 'tsx', 'test/fixtures/sqlite-process.ts', host.directory, 'read'],
      { env: { ...process.env, NODE_V8_COVERAGE: collector } }
    );
    expect(child.stdout.trim()).toBe('read complete');
    const sources = (await recordedSources(collector))
      .filter((url) => url.startsWith('file:'))
      .map((url) => fileURLToPath(url));
    expect(sources).toContain(resolve('src/platform/durable.ts'));
  } finally {
    await host.cleanup();
  }
});
