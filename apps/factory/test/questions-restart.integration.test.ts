import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { z } from 'zod';
import { expect, it, vi } from 'vitest';
import { protocol } from './fixtures/setup.js';
it('retains a parked job across process loss and never repeats an uncertain resume delivery', async () => {
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
  const launch = () => spawn(process.execPath, [resolve('dist/main.js')], { env, stdio: 'ignore' });
  const stop = async (child: ChildProcess) => {
    if (child.exitCode !== null) return;
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
  };
  const ready = () =>
    vi.waitFor(async () => expect((await fetch(`${origin}/health`)).ok).toBe(true), {
      timeout: 10000,
      interval: 30,
    });
  const status = async () => (await fetch(`${origin}/api/job`)).json();
  let child = launch();
  try {
    await ready();
    const initial = z.object({ intent: z.object({ id: z.string() }).passthrough() }).parse(
      await (
        await fetch(`${origin}/api/job`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            issue: 579,
            context: 'Only the selected issue. Preserve this scope.',
          }),
        })
      ).json()
    );
    await host.save({
      activity: [
        {
          itemId: 'q',
          runId: 'run-1',
          sourceThreadId: 'thread-live',
          visibility: 'local',
          type: 'user_input_request',
          status: 'waiting',
          text: 'Which option?',
        },
      ],
      overrides: { status: 'waiting', pendingRequestCount: 1 },
    });
    await vi.waitFor(
      async () =>
        expect(await status()).toMatchObject({
          delivery: { activity: 'awaiting-answer', active: false },
        }),
      { timeout: 10000, interval: 30 }
    );
    await stop(child);
    child = launch();
    await ready();
    expect(await status()).toMatchObject({
      intent: initial.intent,
      resume: { index: 0, questionId: 'q' },
      delivery: { activity: 'awaiting-answer', active: false },
    });
    await host.save({ lostSend: true, overrides: { status: 'completed', pendingRequestCount: 0 } });
    const response = await fetch(`${origin}/api/job/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: initial.intent.id, index: 0, questionId: 'q' }),
    });
    expect(response.status).toBe(503);
    await stop(child);
    await host.save({ overrides: { status: 'completed', pendingRequestCount: 0 } });
    child = launch();
    await ready();
    expect(await status()).toMatchObject({
      intent: initial.intent,
      delivery: { stage: 'implementation', ready: false },
    });
    await status();
    const calls = await host.calls();
    expect(
      calls.filter((call) => call.args[1] === 'start' && !call.args.includes('--help'))
    ).toHaveLength(1);
    const sends = calls.filter(
      (call) => call.args[0] === 'acp-mcp-call' && call.args[1] === 't3_thread_send'
    );
    expect(sends).toHaveLength(1);
    expect(JSON.parse(sends[0].args[2])).toMatchObject({
      threadId: 'thread-live',
      clientRequestId: `${initial.intent.id}:stage:1`,
    });
  } finally {
    await stop(child);
    await host.cleanup();
  }
});
