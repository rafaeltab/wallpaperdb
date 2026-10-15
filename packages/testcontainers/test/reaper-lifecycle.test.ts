import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { connect } from 'node:net';
import { GenericContainer, getContainerRuntimeClient, Wait } from 'testcontainers';
import { expect, it, vi } from 'vitest';
import { createDockerProxy } from './fixtures/docker-proxy.js';

// Allow seed startup (60s), the child (45s), cleanup (30s), and final teardown.
it('starts a container when a selected Ryuk exits and preserves automatic cleanup', async () => {
  const client = await getContainerRuntimeClient();
  const session = randomUUID();
  const seed = await new GenericContainer('testcontainers/ryuk:0.14.0')
    .withExposedPorts(8080)
    .withBindMounts([
      { source: client.info.containerRuntime.remoteSocketPath, target: '/var/run/docker.sock' },
    ])
    .withLabels({
      'org.testcontainers.session-id': session,
      TESTCONTAINERS_RYUK_TEST_LABEL: 'true',
    })
    .withWaitStrategy(Wait.forLogMessage('Started'))
    .start();
  const keeper = connect(seed.getMappedPort(8080), seed.getHost());
  let proxy: Awaited<ReturnType<typeof createDockerProxy>> | undefined;
  try {
    await once(keeper, 'connect');
    keeper.write(`label=org.testcontainers.session-id=${session}\r\n`);
    const [ack] = await once(keeper, 'data');
    expect(ack.toString()).toBe('ACK\n');

    proxy = await createDockerProxy(
      client.info.containerRuntime.remoteSocketPath,
      seed.getId(),
      async () => {
        const exited = client.container.getById(seed.getId()).wait({ condition: 'removed' });
        keeper.end();
        expect((await exited).StatusCode).toBe(0);
      }
    );
    const child = fork(new URL('./fixtures/start-container.mjs', import.meta.url), [], {
      silent: true,
      execArgv: [],
      timeout: 45000,
      env: {
        ...process.env,
        DOCKER_HOST: proxy.host,
        // Holding the lookup must not hold other runners' Testcontainers lock.
        TMPDIR: proxy.temporaryDirectory,
        TESTCONTAINERS_HOST_OVERRIDE: seed.getHost(),
        TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE: client.info.containerRuntime.remoteSocketPath,
        TESTCONTAINERS_RYUK_TEST_LABEL: 'true',
        TESTCONTAINERS_RYUK_DISABLED: 'false',
        DEBUG: 'testcontainers',
      },
    });
    let logs = '';
    let containerId: string | undefined;
    child.stdout?.on('data', (chunk) => {
      logs += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      logs += chunk;
    });
    child.on('message', (message) => {
      if (
        message &&
        typeof message === 'object' &&
        'containerId' in message &&
        typeof message.containerId === 'string'
      ) {
        containerId = message.containerId;
      }
    });
    const [code] = await once(child, 'exit');
    expect(code, logs).toBe(0);
    expect(proxy.didHoldSnapshot()).toBe(true);
    if (!containerId) throw new Error(`Container fixture returned no container ID: ${logs}`);
    const ownedIds = [...proxy.ownedIds];
    expect(ownedIds).toContain(containerId);
    await vi.waitUntil(
      async () => {
        const removed = await Promise.all(
          ownedIds.map(async (id) => {
            try {
              await client.container.getById(id).inspect();
              return false;
            } catch (error) {
              if (error instanceof Error && 'statusCode' in error && error.statusCode === 404)
                return true;
              throw error;
            }
          })
        );
        return removed.every(Boolean);
      },
      { timeout: 30000, interval: 100 }
    );
  } finally {
    keeper.destroy();
    try {
      await proxy?.close();
    } finally {
      // Remove only this fixture's resources if startup or cleanup fails.
      await Promise.all(
        [...(proxy?.ownedIds ?? [seed.getId()])].map(async (id) => {
          try {
            await client.container.getById(id).remove({ force: true, v: true });
          } catch (error) {
            if (error instanceof Error && 'statusCode' in error && error.statusCode === 404) return;
            throw error;
          }
        })
      );
    }
  }
}, 180000);
