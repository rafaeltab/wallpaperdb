import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import { protocol } from './fixtures/setup.js';
it('a fresh process reconciles publication after a lost response without repeating threads, stages or PRs', async () => {
  const host = await protocol();
  await host.save({ complete: true, base: host.base, lostPublication: true });
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
      body: JSON.stringify({ issue: 576, context: 'Read only' }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      kind: 'job',
      execution: { kind: 'found', threadId: 'thread-live' },
    });
    const uncertain = await fetch(origin + '/api/job');
    expect(uncertain.status).toBe(503);
    await stop(child);
    child = launch();
    await ready();
    const recovered = await fetch(origin + '/api/job');
    expect(await recovered.json()).toMatchObject({
      kind: 'job',
      intent: { issue: 576, expectedStage: 'implementation' },
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
      body: JSON.stringify({ issue: 576 }),
    });
    expect(duplicate.status).toBe(409);
    const calls = await host.calls();
    expect(calls.filter((call) => call.binary === 't3' && call.args[1] === 'send')).toHaveLength(2);
    const demonstrated = await (await fetch(origin + '/api/job')).json();
    process.stdout.write(
      'Factory composition demonstration: ' + JSON.stringify(demonstrated) + '\n'
    );
  } finally {
    await stop(child);
    await host.cleanup();
  }
});
