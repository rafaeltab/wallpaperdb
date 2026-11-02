import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('rejects duplicate state assignments before changing the installed unit or contacting the service manager', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-activation-'));
  const release = join(directory, 'release');
  const state = join(directory, 'state');
  const otherState = join(directory, 'other-state');
  const bin = join(directory, 'bin');
  for (const path of [release, state, otherState, bin]) await mkdir(path);
  const unitName = 'wallpaperdb-factory-activation-control';
  const unit = join(directory, '.config/systemd/user', `${unitName}.service`);
  const config = join(directory, 'factory.env');
  const called = join(directory, 'called');
  await writeFile(
    join(release, 'installation.json'),
    JSON.stringify({
      commit: 'b'.repeat(40),
      node: process.execPath,
      stateFormat: 1,
    })
  );
  await writeFile(join(state, 'format.json'), '{"format":1}');
  await writeFile(join(otherState, 'format.json'), '{"format":2}');
  await writeFile(join(bin, 'systemctl'), '#!/bin/sh\ntouch "$HOME/called"\n');
  await chmod(join(bin, 'systemctl'), 0o700);
  const activate = () =>
    execFileSync(
      process.execPath,
      [resolve('scripts/activate.mjs'), release, config, state, unitName],
      {
        encoding: 'utf8',
        env: { ...process.env, HOME: directory, PATH: `${bin}:${process.env.PATH}` },
      }
    );
  try {
    await writeFile(config, `FACTORY_STATE=${state}\n`);
    expect(activate()).toContain('Activated wallpaperdb-factory-activation-control');
    const original = await readFile(unit, 'utf8');
    expect(original).toContain(`${state}/service.lock`);
    expect(original).toContain(`EnvironmentFile=${config}`);
    await rm(called);
    for (const override of [`FACTORY_STATE=${otherState}`, `export FACTORY_STATE=${otherState}`]) {
      await writeFile(config, `FACTORY_STATE=${state}\n${override}\n`);
      expect(activate).toThrow(/exactly one unquoted FACTORY_STATE assignment/);
      expect(await readFile(unit, 'utf8')).toBe(original);
      await expect(readFile(called)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
