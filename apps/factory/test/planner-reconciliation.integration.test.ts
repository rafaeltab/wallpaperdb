import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { plannerState } from '../src/adapters/t3/index.js';
import { initializeState, readRecord } from '../src/platform/index.js';
const execute = promisify(execFile);
it('appends an exact operator non-launch attestation without rewriting the legacy claim or accepting a stale command', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-reconcile-'));
  try {
    initializeState(directory);
    const journal = plannerState(join(directory, 'planner'));
    const requestId = randomUUID();
    const original = { revision: 0, requestId, input: '{}', deadline: 1793900390302 };
    await journal.save(original);
    const args = [
      resolve('dist/main.js'),
      '--reconcile-planner-rejection',
      directory,
      requestId,
      '0',
      'controlled-operator',
      'Explicit server -32602 max-message rejection at controlled boundary',
    ];
    await expect(
      execute(process.execPath, [...args.slice(0, 4), '1', ...args.slice(5)])
    ).rejects.toBeDefined();
    expect(await journal.read()).toEqual(original);
    const result = await execute(process.execPath, args);
    expect(JSON.parse(result.stdout)).toMatchObject({
      requestId,
      revision: 1,
      phase: 'failed',
      retired: true,
      reconciliation: { operator: 'controlled-operator', code: -32602 },
    });
    expect(await readRecord(join(directory, 'planner'), 'planner-0.json')).toEqual(original);
    await expect(execute(process.execPath, args)).rejects.toBeDefined();
    expect((await journal.read())?.revision).toBe(1);
    const bound = {
      ...original,
      revision: 2,
      requestId: randomUUID(),
      run: { threadId: 'thread', runId: 'run' },
    };
    await journal.save(bound);
    await expect(
      execute(process.execPath, [
        resolve('dist/main.js'),
        '--reconcile-planner-rejection',
        directory,
        bound.requestId,
        '2',
        'operator',
        'No matching thread alone is insufficient',
      ])
    ).rejects.toBeDefined();
    expect(await journal.read()).toEqual(bound);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('allows one competing attestation and retains exact historical request lookup after a newer uncertain claim', async () => {
  const { reconcileRejectedPlanner } = await import('../src/adapters/t3/index.js');
  const directory = await mkdtemp(join(tmpdir(), 'factory-reconcile-race-'));
  try {
    initializeState(directory);
    const path = join(directory, 'planner');
    const journal = plannerState(path);
    const requestId = randomUUID();
    const original = {
      revision: 0,
      requestId,
      input: 'Synthetic retained context',
      deadline: 120100,
    };
    await journal.save(original);
    const command = {
      requestId,
      revision: 0,
      operator: 'synthetic-operator',
      evidence: 'Explicit synthetic -32602 validation rejection',
      code: -32602 as const,
    };
    const outcomes = await Promise.allSettled([
      reconcileRejectedPlanner(path, command),
      reconcileRejectedPlanner(path, { ...command, operator: 'competing-operator' }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const retired = await journal.read(requestId);
    expect(retired).toMatchObject({
      requestId,
      revision: 1,
      input: original.input,
      deadline: original.deadline,
      retired: true,
      phase: 'failed',
      reconciliation: { code: -32602, evidence: command.evidence },
    });
    expect(await readRecord(path, 'planner-0.json')).toEqual(original);
    const current = {
      ...original,
      revision: 2,
      requestId: randomUUID(),
      phase: 'uncertain' as const,
    };
    await journal.save(current);
    expect(await plannerState(path).read(requestId)).toEqual(retired);
    expect(await plannerState(path).read(current.requestId)).toEqual(current);
    expect(await plannerState(path).read(randomUUID())).toBeUndefined();
    await expect(reconcileRejectedPlanner(path, command)).rejects.toThrow(
      'exact outstanding unbound request and revision'
    );
    expect(await journal.read()).toEqual(current);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
