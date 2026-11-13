import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { fileStore, fileScheduleStore } from '../src/adapters/store/index.js';
import { initializeState, readRecord } from '../src/platform/index.js';

const commit = 'a'.repeat(40);
const job = {
  id: 'retained-job',
  issue: 42,
  issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/42',
  base: commit,
  context: 'Retained scope',
  branch: 'factory/42',
  createdAt: 100,
  expectedStage: 'implementation' as const,
};
const stage = {
  index: 0,
  stage: 'implementation' as const,
  threadId: 'retained-thread',
  commit,
  previousRunId: null,
};
const layer = {
  issue: 42,
  pr: 102,
  commit,
  branch: 'factory/42',
  url: 'https://github.com/rafaeltab/wallpaperdb/pull/102',
  parent: 'b'.repeat(40),
  prBase: 'main',
};
const operation = { groups: [], members: [102], numbers: [42], layers: [layer], replay: [] };
const operationPath = `joins/${'c'.repeat(64)}`;

async function legacyRecord(root: string, name: string, value: unknown) {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true });
  const bytes = JSON.stringify(value);
  await writeFile(path, bytes);
  return bytes;
}

it('creates a previously nonexistent state path and preserves the winning reservation after reopen', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'factory-migration-'));
  const root = join(temporary, 'new', 'nested', 'state');
  try {
    const store = fileStore(root);
    expect(await Effect.runPromise(store.read())).toBeNull();
    expect(await Effect.runPromise(store.reserve(job))).toBe(true);
    expect(await Effect.runPromise(store.claimLaunch())).toBe(true);
    const reopened = fileStore(root);
    expect(await Effect.runPromise(reopened.read())).toEqual(job);
    expect(await Effect.runPromise(reopened.reserve({ ...job, id: 'competing' }))).toBe(false);
    expect(await Effect.runPromise(reopened.claimLaunch())).toBe(false);
    expect((await readdir(root)).filter((name) => name.endsWith('.json'))).toEqual([]);
    expect(initializeState(root)).toEqual({ format: 2, records: 2 });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

it('imports complete execution and publication journals without changing identities or legacy bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-migration-'));
  const control = { revision: 0, cancelled: false, claimed: [0] };
  const wait = { revision: 0, progress: 'retained-run', deadline: 3600100, nudged: true };
  const schedule = { revision: 0, concurrency: 2, allowance: 3, paused: true, admissions: [] };
  const planner = {
    revision: 0,
    requestId: 'unknown-launch',
    input: 'Retained planner context',
    deadline: 1000,
  };
  const snapshot: Record<string, unknown> = {
    'format.json': { format: 1 },
    'intent.json': job,
    'launch-claimed.json': { version: 1 },
    'stage-0.json': stage,
    'stage-0-run.json': { ...stage, runId: 'retained-run' },
    'control-0.json': control,
    'wait-0.json': wait,
    'schedule-0.json': schedule,
    'planner/planner-0.json': planner,
    [`${operationPath}/intent.json`]: operation,
    [`${operationPath}/seed.json`]: [layer],
    [`${operationPath}/landing.json`]: { anchor: layer, commit, branch: 'main' },
    [`joins/writers/${'d'.repeat(64)}/writer-0.json`]: { key: 'retained-owner' },
    [`${operationPath}/recovery/${'e'.repeat(64)}/launch.json`]: { threadId: 'retained-recovery' },
    [`joins/manual/42/${commit}/resolution.json`]: { commit },
  };
  try {
    const originals = new Map<string, string>();
    for (const [name, value] of Object.entries(snapshot))
      originals.set(name, await legacyRecord(root, name, value));
    expect(initializeState(root)).toEqual({ format: 2, records: 14 });
    expect(initializeState(root)).toEqual({ format: 2, records: 14 });
    const store = fileStore(root);
    expect(await Effect.runPromise(store.read())).toEqual(job);
    expect(await Effect.runPromise(store.readStage(0))).toEqual(stage);
    expect(await Effect.runPromise(store.readControl())).toEqual(control);
    expect(await Effect.runPromise(store.readWait())).toEqual(wait);
    expect(await Effect.runPromise(fileScheduleStore(root).read())).toEqual(schedule);
    expect(await Effect.runPromise(store.claimLaunch())).toBe(false);
    expect(await Effect.runPromise(store.claimStage(0))).toBe(false);
    expect(await Effect.runPromise(store.bindRun(stage, 'retained-run'))).toBe(true);
    expect(await Effect.runPromise(store.bindRun(stage, 'different-run'))).toBe(true);
    for (const [name, value] of Object.entries(snapshot)) {
      expect(await readFile(join(root, name), 'utf8')).toBe(originals.get(name));
      if (name !== 'format.json') {
        const slash = name.lastIndexOf('/');
        expect(
          await readRecord(
            slash < 0 ? root : join(root, name.slice(0, slash)),
            name.slice(slash + 1)
          )
        ).toEqual(value);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  { name: 'stage-0.json', valid: stage, invalid: { ...stage, index: 1 } },
  { name: 'stage-0.json', valid: stage, invalid: { ...stage, commit: 'invalid' } },
  { name: 'stage-0-run.json', valid: { ...stage, runId: 'retained-run' }, invalid: stage },
  { name: 'intent.json', valid: job, invalid: { ...job, expectedStage: 'review' } },
  {
    name: 'planner/planner-0.json',
    valid: { revision: 0, requestId: 'planner', input: 'context', deadline: 100 },
    invalid: { revision: 1, requestId: 'planner', input: 'context', deadline: 100 },
  },
  {
    name: `joins/writers/${'d'.repeat(64)}/writer-0.json`,
    valid: { key: 'owner' },
    invalid: { key: '' },
  },
  {
    name: `${operationPath}/intent.json`,
    valid: operation,
    invalid: { ...operation, layers: null },
  },
  { name: `${operationPath}/seed.json`, valid: [layer], invalid: [{ ...layer, pr: 0 }] },
  {
    name: `${operationPath}/landing.json`,
    valid: { anchor: layer, commit, branch: 'main' },
    invalid: { anchor: layer, commit: 'invalid', branch: 'main' },
  },
  { name: `${operationPath}/launch.json`, valid: { threadId: 'retained' }, invalid: null },
])(
  'rejects invalid legacy $name atomically and imports its valid replacement on retry',
  async ({ name, valid, invalid }) => {
    const root = await mkdtemp(join(tmpdir(), 'factory-migration-'));
    try {
      const original = await legacyRecord(root, name, invalid);
      await legacyRecord(root, 'launch-claimed.json', { version: 1 });
      expect(() => initializeState(root)).toThrow();
      expect(await readFile(join(root, name), 'utf8')).toBe(original);
      const client = new Database(join(root, 'factory.sqlite'));
      try {
        expect(client.prepare('SELECT count(*) AS count FROM records').get()).toEqual({ count: 0 });
        expect(client.prepare('SELECT count(*) AS count FROM metadata').get()).toEqual({
          count: 0,
        });
      } finally {
        client.close();
      }
      await legacyRecord(root, name, valid);
      expect(initializeState(root)).toEqual({ format: 2, records: 2 });
      expect(await Effect.runPromise(fileStore(root).claimLaunch())).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
