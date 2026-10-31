import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { fileStore } from '../src/adapters/store/index.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import { protocol } from './fixtures/setup.js';
it('a fresh process reconciles publication after a lost response without repeating threads, stages or PRs', async () => {
  const host = await protocol();
  await host.save({ base: host.base });
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const env = {
    ...process.env,
    PATH: host.directory + ':' + process.env.PATH,
    FACTORY_FIXTURE: host.configFile,
    FACTORY_PROJECT: host.repository,
    FACTORY_T3_PROJECT_ID: 'project-id',
    FACTORY_BASE: host.base,
    FACTORY_T3_BINARY: host.binary,
    FACTORY_STATE: join(host.directory, 'state'),
    FACTORY_PORT: String(port),
    FACTORY_HOST: '127.0.0.1',
  };
  let diagnostics = '';
  const launch = () => {
    const process = spawn(globalThis.process.execPath, [resolve('dist/main.js')], {
      env,
      stdio: 'pipe',
    });
    process.stderr.on('data', (chunk) => {
      diagnostics += chunk.toString();
    });
    return process;
  };
  const stop = async (child: ChildProcess) => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  };
  const origin = `http://127.0.0.1:${port}`;
  const ready = () =>
    vi.waitFor(
      async () => {
        expect(child.exitCode, diagnostics).toBeNull();
        expect((await fetch(origin + '/health')).ok).toBe(true);
      },
      {
        timeout: 10000,
        interval: 30,
      }
    );
  let child = launch();
  try {
    await ready();
    const response = await fetch(origin + '/api/job', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ issue: 577, context: 'Read only' }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      kind: 'job',
      execution: { kind: 'found', threadId: 'thread-live' },
    });
    await host.save({
      complete: true,
      base: host.base,
      lostPublication: true,
      holdPublication: true,
      overrides: { status: 'completed' },
    });
    await vi.waitFor(
      async () => {
        await fetch(origin + '/api/job');
        expect(
          (await host.calls()).filter(
            (call) =>
              call.binary === 't3' && call.args[1] === 'send' && !call.args.includes('--help')
          )
        ).toHaveLength(2);
      },
      { timeout: 10000, interval: 30 }
    );
    await stop(child);
    await host.save({ complete: true, base: host.base, overrides: { status: 'completed' } });
    child = launch();
    await ready();
    const recovered = await fetch(origin + '/api/job');
    expect(await recovered.json()).toMatchObject({
      kind: 'job',
      intent: { issue: 577, expectedStage: 'implementation' },
      execution: { threadId: 'thread-live' },
      delivery: {
        stage: 'ci',
        ready: true,
        landed: false,
        pr: { url: 'https://github.com/rafaeltab/wallpaperdb/pull/999', commit: host.base },
      },
    });
    const page = await (await fetch(origin)).text();
    expect(page).toContain('t3-thread://v1/thread-live');
    expect(page).toContain('Elapsed:');
    expect(
      (await host.calls()).filter(
        (call) => call.binary === 't3' && call.args[1] === 'start' && !call.args.includes('--help')
      )
    ).toHaveLength(1);
    const duplicate = await fetch(origin + '/api/job', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ issue: 577 }),
    });
    expect(duplicate.status).toBe(409);
    const calls = await host.calls();
    expect(
      calls.filter(
        (call) => call.binary === 't3' && call.args[1] === 'send' && !call.args.includes('--help')
      )
    ).toHaveLength(2);
    const pr = JSON.parse(await readFile(join(host.directory, 'pr.json'), 'utf8'));
    pr.statusCheckRollup[0].conclusion = 'FAILURE';
    const waiting = {
      complete: true,
      base: host.base,
      prs: [pr],
      waitingForGithub: true,
      overrides: { status: 'completed' },
    };
    await host.save(waiting);
    await vi.waitFor(
      async () => {
        const observed = await (await fetch(origin + '/api/job')).json();
        expect(observed).toMatchObject({
          delivery: { stage: 'babysitting', activity: 'waiting-for-github' },
        });
      },
      { timeout: 10000, interval: 30 }
    );
    const initialWait = await Effect.runPromise(
      fileStore(join(host.directory, 'state')).readWait()
    );
    const watcher = {
      ...waiting,
      overrides: { status: 'completed', runCount: 5, latestRunId: 'watcher-5' },
    };
    await host.save(watcher);
    expect(await (await fetch(origin + '/api/job')).json()).toMatchObject({
      delivery: { activity: 'waiting-for-github', deadline: initialWait?.deadline },
    });
    await stop(child);
    const store = fileStore(join(host.directory, 'state'));
    const retained = await Effect.runPromise(store.readWait());
    if (!retained) throw new Error('Expected persisted waiting deadline');
    expect(retained.nudged).toBe(false);
    // Exercise an already expired persisted deadline, without a real hour wait.
    expect(
      await Effect.runPromise(
        store.saveWait({ ...retained, revision: retained.revision + 1, deadline: 0 })
      )
    ).toBe(true);
    await host.save({ ...watcher, lostSend: true });
    child = launch();
    await ready();
    await vi.waitFor(
      async () => {
        await fetch(origin + '/api/job');
        expect(
          (await host.calls()).filter(
            (call) => call.args[1] === 'send' && !call.args.includes('--help')
          )
        ).toHaveLength(4);
      },
      { timeout: 10000, interval: 30 }
    );
    await stop(child);
    expect(
      await Effect.runPromise(fileStore(join(host.directory, 'state')).readWait())
    ).toMatchObject({
      deadline: 0,
      nudged: true,
      continuation: { stage: 'babysitting', continuation: true, threadId: 'thread-live' },
    });
    await host.save(waiting);
    child = launch();
    await ready();
    const pending = await (await fetch(origin + '/api/job')).json();
    expect(pending).toMatchObject({
      delivery: { stage: 'babysitting', activity: 'continuation-pending', ready: false },
    });
    expect(
      (await host.calls()).filter(
        (call) => call.args[1] === 'send' && !call.args.includes('--help')
      )
    ).toHaveLength(4);
    const demonstrated = await (await fetch(origin + '/api/job')).json();
    process.stdout.write(
      'Factory composition demonstration: ' + JSON.stringify(demonstrated) + '\n'
    );
  } finally {
    await stop(child);
    await host.cleanup();
  }
});
