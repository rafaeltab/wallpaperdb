import { expect, it } from 'vitest';
import { type CaseScope, createGroup, timing } from './fixture';

it('bounds a stuck case and rejects late resource acquisition after group shutdown', async () => {
  const metrics = timing();
  const group = await createGroup(metrics, 100);
  let entered = false;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let scope!: CaseScope;
  const running = group.runCase('stuck', async (active) => {
    scope = active;
    await scope.client.set(scope.key('owned'), 'value');
    await scope.subscribe(scope.channel('owned'), () => {});
    entered = true;
    await blocked;
  });
  const caseResult = running.catch((error: unknown) => error);
  let closeResult: Promise<unknown> | undefined;
  try {
    await expect.poll(() => entered, { timeout: 5000 }).toBe(true);
    closeResult = group.close().catch((error: unknown) => error);
    await expect.poll(() => metrics.containersRemoved, { timeout: 6000 }).toBe(1);
    expect(await closeResult).toBeInstanceOf(Error);
    expect(String(await closeResult)).toContain('pending cases');
    expect(metrics.stops).toBe(1);
    expect(() => group.runCase('late', async () => {})).toThrow('group is closing');
    expect(scope.client.isOpen).toBe(false);
    await expect(scope.client.connect()).rejects.toThrow('group is closed');
    await expect(scope.subscribe('late', () => {})).rejects.toThrow('group is closed');
    expect(() => scope.key('late')).toThrow('group is closed');
    expect(() => scope.channel('late')).toThrow('group is closed');
  } finally {
    release();
    await caseResult;
    await (closeResult ?? group.close().catch((error: unknown) => error));
  }
}, 15000);

it.each([
  'QUIT',
  'DEL',
  'UNSUBSCRIBE',
] as const)('bounds stalled %s and preserves the case failure', async (phase) => {
  const metrics = timing();
  const group = await createGroup(metrics, 100);
  let client!: CaseScope['client'];
  let settled = false;
  const result = group
    .runCase('paused', async (scope) => {
      client = scope.client;
      if (phase === 'DEL') await client.set(scope.key('owned'), 'value');
      if (phase === 'UNSUBSCRIBE') await scope.subscribe(scope.channel('owned'), () => {});
      await client.clientPause(5000, 'ALL');
      throw new Error('intentional body failure');
    })
    .catch((error: unknown) => {
      settled = true;
      return error;
    });
  try {
    await expect.poll(() => settled, { timeout: 1500 }).toBe(true);
    const error = await result;
    expect(error).toBeInstanceOf(AggregateError);
    const messages = (error as AggregateError).errors.map(String).join(' ');
    expect(messages).toContain('intentional body failure');
    expect(messages).toContain('timed out');
    expect(client.isOpen).toBe(false);
  } finally {
    await group.close().catch(() => {});
  }
  expect(metrics.containersRemoved).toBe(1);
}, 15000);

it('bounds observer verification when an open Redis socket stops answering', async () => {
  const metrics = timing();
  const group = await createGroup(metrics, 100);
  let client!: CaseScope['client'];
  let closeResult: Promise<unknown> | undefined;
  try {
    await group.runCase('setup', async (scope) => {
      client = scope.client;
    });
    await client.connect();
    await client.clientPause(5000, 'ALL');
    await client.disconnect();
    closeResult = group.close().catch((error: unknown) => error);
    await expect.poll(() => metrics.containersRemoved, { timeout: 1500 }).toBe(1);
    const error = await closeResult;
    const messages =
      error instanceof AggregateError ? error.errors.map(String).join(' ') : String(error);
    expect(messages).toContain('timed out');
  } finally {
    if (client?.isOpen) await client.disconnect();
    await (closeResult ?? group.close().catch(() => {}));
  }
}, 15000);
