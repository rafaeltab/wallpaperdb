import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { joinFixture } from './fixtures/join.js';

const scenarios = [
  { boundary: 'local', edit: '' },
  { boundary: 'remote', edit: '' },
  { boundary: 'base', edit: '' },
  { boundary: 'group', edit: '' },
  { boundary: 'restack', edit: '' },
  { boundary: 'local', edit: 'dirty' },
  { boundary: 'local', edit: 'commit' },
  { boundary: 'remote', edit: 'remote' },
  { boundary: 'base', edit: 'base' },
  { boundary: 'group', edit: 'group' },
  { boundary: 'base', edit: 'ci' },
];
for (const { boundary, edit } of scenarios) {
  it(`recovers the actual factory after SIGKILL at ${boundary} ${edit} while preserving external changes`, async () => {
    const f = await joinFixture({
      conflict: boundary === 'restack',
      restack: boundary === 'restack' ? { outcome: 'SIMPLE' } : undefined,
    });
    const { host, git } = f;
    const initial = JSON.parse(await readFile(host.configFile, 'utf8'));
    await host.save({ ...initial, hold: boundary });
    const marker = join(host.directory, 'held');
    const release = join(host.directory, 'release');
    if (boundary === 'local' || boundary === 'remote') {
      const hook =
        boundary === 'local'
          ? join(host.repository, '.git/hooks/post-rewrite')
          : join(host.directory, 'remote.git/hooks/post-receive');
      await writeFile(
        hook,
        `#!/bin/sh\n${JSON.stringify(process.execPath)} -e 'const fs=require("fs"); fs.writeFileSync(${JSON.stringify(marker)}, "${boundary}"); const end=Date.now()+20000; while(!fs.existsSync(${JSON.stringify(release)})){ if(Date.now()>end)process.exit(1); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20); } fs.writeFileSync(${JSON.stringify(join(host.directory, 'released'))},"done");'\n`
      );
      await chmod(hook, 0o700);
    }
    const socket = createServer().listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    await new Promise<void>((done) => socket.close(() => done()));
    const origin = `http://127.0.0.1:${address.port}`;
    const env = {
      ...process.env,
      FACTORY_FIXTURE: host.configFile,
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: host.directory,
      FACTORY_PORT: String(address.port),
      FACTORY_HOST: '127.0.0.1',
      FACTORY_PREREQUISITES: JSON.stringify([
        { issue: 3, pr: 103, commit: f.d },
        { issue: 4, pr: 104, commit: f.c },
      ]),
    };
    const launch = () =>
      spawn(process.execPath, [resolve('dist/main.js')], { env, stdio: 'ignore' });
    const stop = async (child: ChildProcess) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
    };
    const ready = () =>
      vi.waitFor(async () => expect((await fetch(`${origin}/health`)).ok).toBe(true), {
        timeout: 10000,
        interval: 30,
      });
    let child = launch();
    try {
      await ready();
      const pending = fetch(`${origin}/api/job`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ issue: 5 }),
      }).catch(() => undefined);
      await vi.waitFor(async () => expect(await readFile(marker, 'utf8')).toBe(boundary), {
        timeout: 10000,
        interval: 30,
      });
      await stop(child);
      await pending;
      expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(false);
      await writeFile(release, 'release controlled endpoint');
      await vi.waitFor(
        async () => expect(await readFile(join(host.directory, 'released'), 'utf8')).toBeTruthy(),
        { timeout: 10000, interval: 30 }
      );
      const attempt = git('worktree', 'list', '--porcelain')
        .split('\n')
        .find((line) => line.startsWith('worktree ') && line.includes('/replay-'))
        ?.slice(9);
      if (edit === 'dirty' || edit === 'commit') {
        if (!attempt) throw new Error('Missing automatic worktree');
        await writeFile(join(attempt, 'operator.txt'), 'preserve operator change');
        if (edit === 'commit') {
          git('-C', attempt, 'add', 'operator.txt');
          git('-C', attempt, 'commit', '-m', 'Operator change');
        }
      }
      if (edit === 'remote')
        git('--git-dir=' + join(host.directory, 'remote.git'), 'update-ref', 'refs/heads/C', f.d);
      if (['base', 'group', 'ci'].includes(edit)) {
        const path = join(host.directory, 'join-live.json');
        const live = JSON.parse(await readFile(path, 'utf8'));
        if (edit === 'base') live.prs['104'].base = 'B';
        if (edit === 'group') live.groups[0].pull_requests.pop();
        if (edit === 'ci') live.newCI = 'FAILURE';
        await writeFile(path, JSON.stringify(live));
      }
      child = launch();
      await ready();
      if (edit) {
        // Exercise recovery through the public driving port as well as startup.
        const ports = f.reopen();
        if (!ports.reconcile || !ports.recoveries) throw new Error('Missing recovery ports');
        await Effect.runPromise(ports.reconcile());
        expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(false);
        if (edit === 'dirty' || edit === 'commit') {
          expect(await readFile(join(attempt ?? '', 'operator.txt'), 'utf8')).toBe(
            'preserve operator change'
          );
          expect(git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
        }
        if (edit === 'dirty')
          expect(await Effect.runPromise(ports.recoveries())).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                active: false,
                progress: expect.stringContaining('operator reconciliation'),
              }),
            ])
          );
        if (edit === 'remote')
          expect(git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.d);
        if (edit === 'base' || edit === 'group') {
          const live = JSON.parse(await readFile(join(host.directory, 'join-live.json'), 'utf8'));
          if (edit === 'base') expect(live.prs['104'].base).toBe('B');
          if (edit === 'group')
            expect(
              live.groups[0].pull_requests.map((item: { number: number }) => item.number)
            ).toEqual([101, 102, 103]);
        }
        return;
      }
      await vi.waitFor(
        async () =>
          expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(true),
        { timeout: 10000, interval: 30 }
      );
      const observed = await Effect.runPromise(f.reopen().inspect(5));
      const head = observed.prerequisite?.base;
      expect(head).toBeTruthy();
      expect(git('log', '--format=%s', `${host.base}..${head}`)).toBe('C\nD\nB\nA');
      expect(git('rev-list', '--merges', `${host.base}..${head}`)).toBe('');
      expect(git('ls-remote', '--heads', 'origin', 'refs/heads/D').split(/\s/)[0]).toBe(f.d);
      expect(git('show', `${head}:B.txt`)).toBe('B');
      if (boundary !== 'restack') expect(git('show', `${head}:C.txt`)).toBe('C');
      const live = JSON.parse(await readFile(join(host.directory, 'join-live.json'), 'utf8'));
      expect(live.prs['104'].base).toBe('D');
      expect(live.groups[0].pull_requests.map((item: { number: number }) => item.number)).toEqual([
        101, 102, 103, 104,
      ]);
      const calls = await host.calls();
      expect(
        calls.filter(
          (call) =>
            call.args[1] === 'start' &&
            !call.args.includes('--help') &&
            call.args.includes('--title')
        ).length
      ).toBe(boundary === 'restack' ? 1 : 0);
      expect(
        calls.filter(
          (call) =>
            call.args.includes('repos/rafaeltab/wallpaperdb/stacks') && call.args.includes('POST')
        )
      ).toHaveLength(1);
      if (boundary === 'local')
        expect(git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(2);
      process.stdout.write(
        `Restack SIGKILL recovery ${boundary}: ${JSON.stringify({ head, target: live.prs['104'].base, members: live.groups[0].pull_requests, ready: observed.blockersReady, storage: 'production journal', protocols: 'controlled GitHub/T3/CI; operator asserted prerequisite reviews', landing: false })}\n`
      );
    } finally {
      await writeFile(release, 'cleanup');
      await stop(child);
      await f.close();
    }
  });
}
