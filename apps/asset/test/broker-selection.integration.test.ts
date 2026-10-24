import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { renderBrokerConfiguration } from '../src/adapters/commands/index.js';
import { parseAuthority } from '../src/authority.js';
import { authorityFixture } from './fixtures/authority.js';

const exec = promisify(execFile);
async function caller(mode: string, url: string, directory: string, ca?: string) {
  // Only this disposable child trusts the fixture CA. Parent/OS trust is unchanged.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        key !== 'NODE_EXTRA_CA_CERTS' &&
        key !== 'NODE_OPTIONS' &&
        !key.startsWith('DOTENV_') &&
        !key.startsWith('OTEL_')
    )
  );
  const result = await exec(
    process.execPath,
    [
      '--import',
      resolve('node_modules/tsx/dist/loader.mjs'),
      resolve('test/fixtures/broker-selection.ts'),
      mode,
      url,
      join(directory, 'authority.json'),
    ],
    {
      cwd: directory,
      env: { ...environment, ...(ca ? { NODE_EXTRA_CA_CERTS: ca } : {}) },
      timeout: 15000,
    }
  ).then(
    () => true,
    (error: unknown) => {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 1) throw error;
      return false;
    }
  );
  return result;
}
it('refuses plaintext INFO before authenticating when protected callers select TLS', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-broker-selection-'));
  const sockets = new Set<Socket>();
  let authentications = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.write(
      'INFO {"server_id":"plaintext-fixture","version":"2.10.0","proto":1,"max_payload":1048576,"auth_required":true,"tls_required":false}\r\n'
    );
    socket.on('data', (data) => {
      if (data.includes('CONNECT ')) {
        authentications++;
        socket.end("-ERR 'Controlled plaintext authentication rejection'\r\n");
      }
    });
  });
  try {
    await writeFile(join(directory, 'authority.json'), JSON.stringify(authorityFixture()), {
      mode: 0o600,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing protocol fixture');
    for (const mode of ['commands', 'notifications', 'operator', 'events']) {
      const before = authentications;
      expect(await caller(mode, `tls://127.0.0.1:${address.port}`, directory)).toBe(false);
      expect(authentications - before, `${mode} sent authentication to plaintext INFO`).toBe(0);
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

it('accepts the selected trusted TLS broker with default verification and preserves ordinary plaintext callers', async () => {
  const releases: Array<() => Promise<unknown>> = [];
  const failures: unknown[] = [];
  try {
    const directory = await mkdtemp(join(tmpdir(), 'asset-broker-trust-'));
    releases.push(() => rm(directory, { recursive: true, force: true }));
    const cert = join(directory, 'localhost.crt');
    const key = join(directory, 'localhost.key');
    await exec('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout',
      key,
      '-out',
      cert,
    ]);
    const authority = parseAuthority(authorityFixture());
    await writeFile(join(directory, 'authority.json'), JSON.stringify(authorityFixture()), {
      mode: 0o600,
    });
    for (const tls of [true, false]) {
      const config = JSON.parse(renderBrokerConfiguration(authority));
      if (tls) config.tls = { cert_file: '/cert.crt', key_file: '/cert.key' };
      const container = await new GenericContainer('nats:2.10-alpine')
        .withCopyContentToContainer([
          { content: JSON.stringify(config), target: '/asset.conf' },
          { content: await readFile(cert), target: '/cert.crt' },
          { content: await readFile(key), target: '/cert.key' },
        ])
        .withCommand(['-c', '/asset.conf'])
        .withExposedPorts(4222)
        .withWaitStrategy(Wait.forLogMessage('Server is ready'))
        .start();
      releases.push(() => container.stop());
      const url = `${tls ? 'tls' : 'nats'}://${container.getHost()}:${container.getMappedPort(4222)}`;
      if (tls) expect(await caller('operator', url, directory)).toBe(false);
      else expect(await caller('operator', url.replace('nats://', ''), directory)).toBe(true);
      for (const mode of ['operator', 'commands', 'notifications', 'legacy-setup', 'events'])
        expect(await caller(mode, url, directory, tls ? cert : undefined), mode).toBe(true);
      await container.stop();
    }
  } catch (error) {
    failures.push(error);
  } finally {
    for (const release of releases.reverse()) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Broker trust contract failed');
});
