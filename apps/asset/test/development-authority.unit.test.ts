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

it.each([false, true])(
  'adds explicitly configured origins to both services with duplicate existing origins: %s',
  async (duplicateExistingOrigins) => {
    const directory = await mkdtemp(join(tmpdir(), 'asset-dev-origins-'));
    const options = {
      issuer: 'https://selected.clerk.accounts.dev',
      ingress: 'http://localhost:8970',
    };
    try {
      await configureDevelopment(directory, options);
      const path = join(directory, 'apps/asset/.authority.json');
      const initial = readAuthority(path);
      if (duplicateExistingOrigins) {
        const existing = JSON.parse(await readFile(path, 'utf8'));
        existing.identityProviders.clerk.authorizedParties.push(
          ...existing.identityProviders.clerk.authorizedParties
        );
        await writeFile(path, JSON.stringify(existing));
      }
      await configureDevelopment(directory, {
        ...options,
        additionalAuthorizedOrigins: ['http://zerotwo:8970', 'http://wallpaperdb-http.test:8970/'],
      });
      await configureDevelopment(directory, {
        ...options,
        additionalAuthorizedOrigins: ['http://zerotwo:8970'],
      });
      await configureDevelopment(directory, options);
      const configured = readAuthority(path);
      const expected = [
        'http://localhost:8970',
        'http://127.0.0.1:8970',
        'http://zerotwo:8970',
        'http://wallpaperdb-http.test:8970',
      ];
      expect(configured.identityProviders.clerk?.authorizedParties).toEqual(expected);
      expect(configured.broker).toEqual(initial.broker);
      expect(configured.applications).toEqual(initial.applications);
      expect(configured.identityProviders.clerk?.requireAuthorizedParty).toBe(
        initial.identityProviders.clerk?.requireAuthorizedParty
      );
      const workflow = JSON.parse(
        await readFile(join(directory, 'apps/wallpaper/.workflow.json'), 'utf8')
      );
      expect(workflow.identityProviders[0].authorizedParties).toEqual(expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it.each([
  '*',
  'file:///tmp/origin',
  'http://example.test/path',
  'http://user:password@example.test',
  'https://example.test?query=yes',
])('rejects an additional origin that is not an HTTP(S) origin: %s', async (origin) => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-invalid-origin-'));
  try {
    await configureDevelopment(directory, {
      issuer: 'https://selected.clerk.accounts.dev',
      ingress: 'http://localhost:8970',
    });
    const path = join(directory, 'apps/asset/.authority.json');
    const before = await readFile(path, 'utf8');
    await expect(
      configureDevelopment(directory, {
        issuer: 'https://selected.clerk.accounts.dev',
        ingress: 'http://localhost:8970',
        additionalAuthorizedOrigins: [origin],
      })
    ).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
