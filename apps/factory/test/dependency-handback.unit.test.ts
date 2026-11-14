import { expect, it } from 'vitest';
import { completionFixture as fixture } from './fixtures/completion.js';

it('hands validated dependencies to the idle owning agent and releases only after authoritative verification', async () => {
  const f = await fixture();
  try {
    f.state({ idle: true, dependencies: ['758'] });
    await f.status();
    expect(f.sends.at(-1)).toMatchObject({ handback: ['758'], threadId: 'owner' });
    f.state({ idle: true });
    expect(await f.status()).toMatchObject({ delivery: { activity: 'continuation-pending' } });
    f.state({ idle: true, handbackVerified: true });
    expect(await f.status()).toMatchObject({
      delivery: { activity: 'dependency-handback', active: false },
    });
    await f.status();
    expect(f.sends).toHaveLength(2);
  } finally {
    await f.close();
  }
});

it.each(['invalid', 'cycle'] as const)(
  'reconciles invalid requests and blocks cycles: %s',
  async (dependencyResult) => {
    const f = await fixture();
    try {
      f.state({ idle: true, dependencies: ['758'], dependencyResult });
      const status = await f.status();
      if (dependencyResult === 'invalid') expect(f.sends.at(-1)?.reconciliation).toBe('state');
      else
        expect(status).toMatchObject({ delivery: { activity: 'manual-recovery', active: false } });
      expect(f.sends.some((stage) => stage.handback)).toBe(false);
    } finally {
      await f.close();
    }
  }
);

it.each([0, 1, 2])(
  'accepts dependency discovery at stage %i without claiming successful implementation',
  async (advances) => {
    const f = await fixture();
    try {
      for (let index = 0; index < advances; index++) {
        f.state({ idle: true, accepted: true });
        await f.status();
      }
      f.state({ idle: true, accepted: false, dependencies: ['758'] });
      await f.status();
      expect(f.sends.at(-1)?.handback).toEqual(['758']);
    } finally {
      await f.close();
    }
  }
);
it('keeps busy descendants and cancelled attempts from authorizing handback effects', async () => {
  const f = await fixture();
  try {
    f.state({ dependencies: ['758'] });
    const busy = await f.status();
    expect(f.sends).toEqual([]);
    if (busy.kind !== 'job') throw new Error('Missing job');
    await f.cancel(busy.intent.id);
    f.state({ idle: true, handbackVerified: true });
    expect(await f.status()).toMatchObject({ delivery: { activity: 'cancelled' } });
    expect(f.sends).toEqual([]);
  } finally {
    await f.close();
  }
});

it('uses bounded reconciliation for an authoritatively incomplete idle handback', async () => {
  const f = await fixture(1);
  try {
    f.state({ idle: true, dependencies: ['758'] });
    await f.status();
    f.state({ idle: true });
    expect(await f.status()).toMatchObject({ reconciliation: { attempts: 1 } });
    expect(f.sends).toHaveLength(2);
    f.state({ idle: true });
    expect(await f.status()).toMatchObject({
      delivery: { activity: 'manual-recovery', active: false },
    });
    expect(f.sends).toHaveLength(2);
  } finally {
    await f.close();
  }
});

it.each(['valid', 'invalid', 'cycle'] as const)(
  'validates a superseding dependency response before release: %s',
  async (dependencyResult) => {
    const f = await fixture();
    try {
      f.state({ idle: true, dependencies: ['758'] });
      await f.status();
      f.state({ idle: true, dependencies: ['759'], dependencyResult, handbackVerified: true });
      const observed = await f.status();
      expect(observed).not.toMatchObject({ delivery: { activity: 'dependency-handback' } });
      if (dependencyResult === 'valid') {
        expect(f.sends.at(-1)).toMatchObject({ handback: ['759'], reconciliation: 'state' });
        f.state({ idle: true });
        expect(await f.status()).toMatchObject({
          delivery: { activity: 'dependency-handback', active: false },
        });
      } else if (dependencyResult === 'cycle') {
        expect(observed).toMatchObject({
          delivery: { activity: 'manual-recovery', active: false },
        });
      } else expect(observed).toMatchObject({ reconciliation: { attempts: 1 } });
    } finally {
      await f.close();
    }
  }
);
