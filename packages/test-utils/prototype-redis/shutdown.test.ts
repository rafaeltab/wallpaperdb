import { expect, it } from 'vitest';
import { type CaseScope, createGroup, timing } from './fixture';

it.each([
  'success',
  'failure',
] as const)('invalidates a finished %s case while a peer remains active', async (outcome) => {
  const group = await createGroup();
  let retired!: CaseScope;
  let retiredChannel = '';
  try {
    await group.runCase('survivor', async (survivor) => {
      const key = survivor.key('owned');
      const channel = survivor.channel('owned');
      const messages: string[] = [];
      await survivor.client.set(key, 'survives');
      await survivor.subscribe(channel, (message) => messages.push(message));
      const finished = group.runCase('retired', async (scope) => {
        retired = scope;
        await scope.client.set(scope.key('owned'), 'removed');
        retiredChannel = scope.channel('owned');
        await scope.subscribe(retiredChannel, () => {});
        if (outcome === 'failure') throw new Error('intentional case failure');
      });
      if (outcome === 'failure') {
        await expect(finished).rejects.toThrow('intentional case failure');
      } else {
        await finished;
      }
      // Retained callbacks must not acquire resources after their case settles.
      await expect(retired.client.connect()).rejects.toThrow('case is closed');
      await expect(retired.subscribe(retiredChannel, () => {})).rejects.toThrow('case is closed');
      expect(() => retired.key('late')).toThrow('case is closed');
      expect(() => retired.channel('late')).toThrow('case is closed');
      expect(retired.client.isOpen).toBe(false);
      expect(await survivor.client.get(key)).toBe('survives');
      expect(await survivor.client.dbSize()).toBe(1);
      expect((await survivor.client.pubSubNumSub(retiredChannel))[retiredChannel]).toBe(0);
      await survivor.client.publish(channel, 'still active');
      await expect.poll(() => messages).toEqual(['still active']);
    });
  } finally {
    if (retired?.client.isOpen) await retired.client.disconnect();
    await group.close();
  }
});

it('rejects a detached subscription acquisition that outlives its case', async () => {
  const group = await createGroup();
  let acquisition!: Promise<unknown>;
  let settled = false;
  let prefix = '';
  try {
    await group
      .runCase('detached', async (scope) => {
        const channel = scope.channel('owned');
        prefix = channel.split(':channel:')[0];
        acquisition = scope
          .subscribe(channel, () => {})
          .catch((error: unknown) => error)
          .finally(() => {
            settled = true;
          });
      })
      .catch(() => {});
    await expect.poll(() => settled, { timeout: 5000 }).toBe(true);
    const error = await acquisition;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('case is closed');
    await group.runCase('survivor', async (scope) => {
      const key = scope.key('owned');
      await scope.client.set(key, 'survives');
      expect(await scope.client.get(key)).toBe('survives');
      expect(
        (await scope.client.clientList()).some((client) => client.name.startsWith(prefix))
      ).toBe(false);
    });
  } finally {
    await group.close();
  }
});

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
  'UNSUBSCRIBE',
] as const)('bounds stalled %s and preserves the case failure', async (phase) => {
  const metrics = timing();
  const group = await createGroup(metrics, 100);
  let client!: CaseScope['client'];
  let settled = false;
  const result = group
    .runCase('paused', async (scope) => {
      client = scope.client;
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
      // This test owns an independent control connection, outside the retired case.
      client = scope.client.duplicate({
        socket: { reconnectStrategy: false, connectTimeout: 3000 },
      });
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
