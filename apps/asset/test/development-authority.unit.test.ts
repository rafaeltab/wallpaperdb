import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { configureDevelopment } from '../scripts/development-authority.js';
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
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await configureDevelopment(directory, {
      issuer: 'https://selected.clerk.accounts.dev',
      ingress: 'http://localhost:8970',
    });
    expect(await readFile(path, 'utf8')).toBe(first);
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
