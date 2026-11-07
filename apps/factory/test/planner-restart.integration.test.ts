import { z } from 'zod';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { protocol } from './fixtures/setup.js';
import { stopOwnedProcesses, stopProcess as stop } from './fixtures/processes.js';
it('reattaches a durable planner run after process death without launching another planner', async () => {
  const host = await protocol();
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  await new Promise<void>((done) => socket.close(() => done()));
  const origin = `http://127.0.0.1:${address.port}`;
  const authorization = `${host.directory}/authorization`;
  await writeFile(authorization, 'Bearer controlled-protocol');
  const env = {
    ...process.env,
    PATH: `${host.directory}:${process.env.PATH}`,
    FACTORY_FIXTURE: host.configFile,
    FACTORY_PROJECT: host.repository,
    FACTORY_T3_PROJECT_ID: 'project-id',
    FACTORY_BASE: host.base,
    FACTORY_T3_BINARY: host.binary,
    FACTORY_STATE: `${host.directory}/state`,
    FACTORY_PORT: String(address.port),
    FACTORY_HOST: '127.0.0.1',
    FACTORY_T3_MCP_ENDPOINT: 'http://127.0.0.1:1/mcp',
    FACTORY_T3_MCP_AUTHORIZATION_FILE: authorization,
  };
  const children: ChildProcess[] = [];
  const launch = () => {
    const child = spawn(process.execPath, [resolve('dist/main.js')], {
      env,
      stdio: 'ignore',
      detached: true,
    });
    children.push(child);
    return child;
  };
  const ready = () =>
    vi.waitFor(async () => expect((await fetch(`${origin}/health`)).ok).toBe(true), {
      timeout: 10000,
      interval: 30,
    });
  let child = launch();
  try {
    await ready();
    await host.save({
      planning: { candidates: [], issues: [] },
      planner: { status: 'running', proposal: { selected: [], deferred: [] } },
    });
    const submitted = await fetch(`${origin}/api/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(submitted.status).toBe(202);
    const { id } = z.object({ id: z.string().uuid() }).parse(await submitted.json());
    await vi.waitFor(
      async () =>
        expect(
          (await host.calls()).some(
            (call) => call.args[1] === 'show' && call.args[2] === 'planner-thread'
          )
        ).toBe(true),
      { timeout: 10000, interval: 30 }
    );
    await stop(child);

    child = launch();
    await ready();
    expect(
      (
        await fetch(`${origin}/api/plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status
    ).toBe(409);
    await host.save({
      planning: { candidates: [], issues: [] },
      planner: { proposal: { selected: [], deferred: [] } },
    });
    await vi.waitFor(
      async () => {
        const recovered = await fetch(`${origin}/api/plan/${id}`);
        expect(recovered.status).toBe(200);
        expect(await recovered.json()).toMatchObject({
          id,
          phase: 'succeeded',
          result: { kind: 'preview', selected: [] },
        });
      },
      { timeout: 10000, interval: 50 }
    );
    const starts = (await host.calls()).filter(
      (call) => call.args[1] === 'start' && !call.args.includes('--help')
    );
    expect(starts).toHaveLength(1);
    process.stdout.write(
      'Planner process recovery: ' +
        JSON.stringify({
          killed: 'SIGKILL',
          recovered: 'preview',
          plannerLaunches: starts.length,
          protocols: 'controlled T3/GitHub',
          storage: 'production durable journal',
        }) +
        '\n'
    );
  } finally {
    await stopOwnedProcesses(children);
    await host.cleanup();
  }
});
