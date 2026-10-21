import { expect, it } from 'vitest';
import { type CaseScope, createGroup, timing } from './fixture';

it('bounds a stuck case and rejects late resource acquisition after group shutdown', async () => {
  const metrics = timing();
  const group = await createGroup(metrics);
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
