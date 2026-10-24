import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { configureDevelopment } from '../scripts/development-authority.js';
import { readAuthority } from '../src/authority.js';
import { authorityFixture } from './fixtures/authority.js';

const exec = promisify(execFile);
it('mounts only the selected notification token into the actual Compose inbox and retains authenticated receipts across restart', async () => {
  const releases: Array<() => Promise<unknown>> = [];
  const failures: unknown[] = [];
  try {
    const directory = await mkdtemp(join(tmpdir(), 'asset-inbox-configuration-'));
    releases.push(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, 'apps/asset'), { recursive: true });
    await mkdir(join(directory, 'infra'), { recursive: true });
    await mkdir(join(directory, 'scripts'), { recursive: true });
    const source = join(directory, 'apps/asset/.authority.json');
    const raw = authorityFixture();
    // Distinguishable synthetic privileges must remain with the authority consumers.
    await writeFile(source, JSON.stringify(raw), { mode: 0o600 });
    const options = {
      issuer: raw.identityProviders.clerk.issuer,
      ingress: 'http://localhost:8970',
    };
    await configureDevelopment(directory, options);
    const projection = join(directory, 'infra/.operator-inbox.json');
    const first = await readFile(projection, 'utf8');
    expect(JSON.parse(first)).toEqual({ operatorNotification: { token: 'operator-inbox-token' } });
    expect((await stat(projection)).mode & 0o777).toBe(0o600);
    await configureDevelopment(directory, options);
    expect(await readFile(projection, 'utf8')).toBe(first);
    expect(readAuthority(source).broker.service.password).toBe('service-secret');
    expect(readAuthority(source).broker.operator.password).toBe('operator-secret');
    expect(readAuthority(source).applications.user?.credentials[0]?.password).toBe('user-secret');
    const broker = await readFile(join(directory, 'infra/nats/.generated.conf'), 'utf8');
    for (const value of ['service-secret', 'operator-secret', 'user-secret', 'wallpaper-secret'])
      expect(broker).toContain(value);
    for (const ignore of ['.gitignore', '.dockerignore'])
      expect((await readFile(resolve('../..', ignore), 'utf8')).split('\n')).toContain(
        'infra/.operator-inbox.json'
      );
    await copyFile(
      resolve('../../infra/docker-compose.yml'),
      join(directory, 'infra/docker-compose.yml')
    );
    await copyFile(
      resolve('../../scripts/operator-inbox.mjs'),
      join(directory, 'scripts/operator-inbox.mjs')
    );
    const override = join(directory, 'infra/ports.json');
    await writeFile(
      override,
      JSON.stringify({ services: { 'asset-operator-inbox': { ports: ['127.0.0.1::3012'] } } })
    );
    const empty = join(directory, 'empty.env');
    await writeFile(empty, '');
    const project = `asset-inbox-proof-${randomUUID()}`;
    const args = [
      'compose',
      '--env-file',
      empty,
      '-p',
      project,
      '-f',
      join(directory, 'infra/docker-compose.yml'),
      '-f',
      override,
    ];
    const environment = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOCKER_CONFIG: process.env.DOCKER_CONFIG,
      // Preserve CI's invocation-scoped trust and locked tool selection.
      MISE_TRUSTED_CONFIG_PATHS: process.env.MISE_TRUSTED_CONFIG_PATHS,
      MISE_LOCKED: process.env.MISE_LOCKED,
      MISE_AUTO_INSTALL: process.env.MISE_AUTO_INSTALL,
    };
    const compose = (...action: string[]) =>
      exec('docker', [...args, ...action], { env: environment, timeout: 30000 });
    const config = JSON.parse((await compose('config', '--format', 'json')).stdout);
    const service = config.services['asset-operator-inbox'];
    expect(service.environment.OPERATOR_INBOX_CONFIG).toBe('/config/operator-inbox.json');
    expect(
      service.volumes.filter((mount: { target: string }) => mount.target.startsWith('/config/'))
    ).toEqual([
      expect.objectContaining({
        source: projection,
        target: '/config/operator-inbox.json',
        read_only: true,
      }),
    ]);
    expect(service.volumes.some((mount: { source: string }) => mount.source === source)).toBe(
      false
    );
    // Register before Compose can partially create the owned project.
    releases.push(() => compose('down', '--volumes', '--remove-orphans'));
    await compose('up', '-d', '--no-deps', 'asset-operator-inbox');
    const port = (await compose('port', 'asset-operator-inbox', '3012')).stdout.trim();
    let url = `http://${port}`;
    const receipts = async (authorization: string) => {
      const response = await fetch(`${url}/receipts`, {
        headers: { authorization },
        signal: AbortSignal.timeout(1000),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        return response.status;
      }
      return response.json();
    };
    const authentication = `Basic ${Buffer.from('operator:operator-inbox-token').toString('base64')}`;
    await expect.poll(() => receipts(authentication), { timeout: 10000 }).toEqual([]);
    expect(
      await receipts(`Basic ${Buffer.from('operator:service-secret').toString('base64')}`)
    ).toBe(401);
    // Inspect the actual running mount; only the token is available at the executable's selected path.
    const observed = JSON.parse(
      (
        await compose(
          'exec',
          '-T',
          'asset-operator-inbox',
          'node',
          '-e',
          'process.stdout.write(JSON.stringify(JSON.parse(require("node:fs").readFileSync(process.env.OPERATOR_INBOX_CONFIG,"utf8"))))'
        )
      ).stdout
    );
    expect(observed).toEqual({ operatorNotification: { token: 'operator-inbox-token' } });
    const notice = {
      id: 'f'.repeat(64),
      applicationId: 'user',
      kind: 'result-quarantine',
      subject: 'asset.results.user',
      reason: 'exhausted',
    };
    const deliver = async () => {
      const response = await fetch(`${url}/events`, {
        method: 'POST',
        headers: { authorization: 'Bearer operator-inbox-token' },
        body: JSON.stringify(notice),
        signal: AbortSignal.timeout(1000),
      });
      expect(response.status).toBe(200);
      await response.body?.cancel();
    };
    await deliver();
    await compose('restart', 'asset-operator-inbox');
    const restartedPort = (await compose('port', 'asset-operator-inbox', '3012')).stdout.trim();
    console.info('Owned inbox mapping across restart', { initial: port, restarted: restartedPort });
    url = `http://${restartedPort}`;
    await expect
      .poll(() => receipts(authentication), { timeout: 10000 })
      .toEqual([expect.objectContaining({ notice })]);
    await deliver();
    expect(await receipts(authentication)).toEqual([expect.objectContaining({ notice })]);
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
  if (failures.length) throw new AggregateError(failures, 'Inbox configuration contract failed');
});
