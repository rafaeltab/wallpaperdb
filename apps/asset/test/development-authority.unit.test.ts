import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { configureDevelopment, developmentIssuer } from '../scripts/development-authority.js';
import { readAuthority } from '../src/authority.js';
it('preserves configured identities and credentials across setup and keeps generated secrets private', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-dev-authority-'));
  try {
    await configureDevelopment(directory, {
      issuer: 'https://unconfigured.clerk.accounts.dev',
      ingress: 'http://localhost:8970',
    });
    const initialCredential = readAuthority(join(directory, 'apps/asset/.authority.json')).broker
      .service.password;
    await configureDevelopment(directory, {
      issuer: 'https://selected.clerk.accounts.dev',
      ingress: 'http://localhost:8970',
    });
    const path = join(directory, 'apps/asset/.authority.json');
    const first = await readFile(path, 'utf8');
    const authority = readAuthority(path);
    expect(authority.identityProviders.clerk?.issuer).toBe('https://selected.clerk.accounts.dev');
    expect(authority.broker.service.password).toBe(initialCredential);
    expect(authority.applications.user?.allowedOperations).toEqual(['create', 'delete']);
    expect(authority.applications.wallpaper?.allowedOperations).toEqual(['create', 'delete']);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const userWorkflow = join(directory, 'apps/user/.workflow.json');
    const userConfig = JSON.parse(await readFile(userWorkflow, 'utf8'));
    expect(userConfig.credential).toEqual({
      user: authority.applications.user?.credentials[0]?.user,
      password: authority.applications.user?.credentials[0]?.password,
    });
    expect(userConfig.operatorNotification).toEqual({
      url: authority.operatorNotification.url,
      token: authority.operatorNotification.token,
    });
    expect((await stat(userWorkflow)).mode & 0o777).toBe(0o600);
    await configureDevelopment(directory, {
      issuer: 'https://selected.clerk.accounts.dev',
      ingress: 'http://localhost:8970',
    });
    expect(await readFile(path, 'utf8')).toBe(first);
    const restricted = JSON.parse(first);
    restricted.applications.user.allowedOperations = ['create'];
    await writeFile(path, JSON.stringify(restricted));
    await configureDevelopment(directory, {
      issuer: 'https://selected.clerk.accounts.dev',
      ingress: 'http://localhost:8970',
    });
    expect(readAuthority(path).applications.user?.allowedOperations).toEqual(['create']);
    await writeFile(path, '{}');
    await expect(
      configureDevelopment(directory, {
        issuer: 'https://selected.clerk.accounts.dev',
        ingress: 'http://localhost:8970',
      })
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('selects the configured development Clerk issuer from the explicit domain or publishable key', () => {
  const key = `pk_test_${Buffer.from('selected.clerk.accounts.dev$').toString('base64')}`;
  expect(developmentIssuer({ CLERK_PUBLISHABLE_KEY: key })).toBe(
    'https://selected.clerk.accounts.dev'
  );
  expect(
    developmentIssuer({ CLERK_DOMAIN: 'explicit.clerk.accounts.dev', CLERK_PUBLISHABLE_KEY: key })
  ).toBe('https://explicit.clerk.accounts.dev');
  expect(developmentIssuer({})).toBe('https://unconfigured.clerk.accounts.dev');
  expect(
    developmentIssuer({ CLERK_PUBLISHABLE_KEY: 'replace_with_valid_clerk_publishable_key' })
  ).toBe('https://unconfigured.clerk.accounts.dev');
  expect(() => developmentIssuer({ CLERK_PUBLISHABLE_KEY: 'invalid' })).toThrow();
});
