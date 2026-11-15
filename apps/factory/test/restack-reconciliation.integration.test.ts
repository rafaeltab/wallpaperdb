import { readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { joinFixture } from './fixtures/join.js';

it('includes the actual shared fenced TypeScript union in initial and review recovery instructions', async () => {
  const f = await joinFixture({
    inProcess: true,
    conflict: true,
    restack: { outcome: 'SIMPLE', review: true },
  });
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    const calls = (await f.host.calls()).filter((call) => ['start', 'send'].includes(call.args[1]));
    expect(calls.map((call) => call.args[1])).toEqual(['start', 'send']);
    for (const call of calls) {
      expect(call.args[3]).toContain('```typescript\ntype AgentResponse =');
      expect(call.args[3]).toContain(
        "kind: 'dependencies'; jobId: string; requireUnimplementedIssues: string[] };\n```"
      );
    }
  } finally {
    await f.close();
  }
});

it('spends the configured reconciliation limit durably on the same idle worker and then requires manual recovery', async () => {
  const f = await joinFixture({
    inProcess: true,
    independentMain: true,
    automaticReview: false,
    reconciliationLimit: 2,
  });
  try {
    for (let n = 0; n < 4; n++) await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(false);
    const calls = await f.host.calls();
    expect(calls.filter((call) => call.args[1] === 'start')).toHaveLength(1);
    expect(calls.filter((call) => call.args[1] === 'send')).toHaveLength(2);
    expect(await Effect.runPromise(f.reopen().recoveries?.() ?? Effect.succeed([]))).toContainEqual(
      expect.objectContaining({
        phase: 'manual-recovery',
        active: false,
        progress: expect.stringContaining('limit'),
      })
    );
  } finally {
    await f.close();
  }
});

async function configure(f: Awaited<ReturnType<typeof joinFixture>>, patch: object) {
  await f.host.save({ ...JSON.parse(await readFile(f.host.configFile, 'utf8')), ...patch });
}
async function worker(f: Awaited<ReturnType<typeof joinFixture>>) {
  const name = (await readdir(f.host.directory)).find(
    (name) => name.startsWith('restacker') && name.endsWith('.json')
  );
  if (!name) throw new Error('Missing recovery worker');
  const path = join(f.host.directory, name);
  return { path, state: JSON.parse(await readFile(path, 'utf8')) };
}
const prepare = (f: Awaited<ReturnType<typeof joinFixture>>) =>
  Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
const recoveries = (f: Awaited<ReturnType<typeof joinFixture>>) =>
  Effect.runPromise(f.reopen().recoveries?.() ?? Effect.succeed([]));

it.each(['completed', 'cancelled', 'rolled_back'])(
  'gates the initial review effect after resolution when its worker becomes %s',
  async (status) => {
    const f = await joinFixture({
      inProcess: true,
      conflict: true,
      restack: { outcome: 'SIMPLE', review: true },
    });
    try {
      const original = `${f.host.binary}-original`;
      await rename(f.host.binary, original);
      await f.host.nodeCommand(
        't3-wrapper',
        `
        import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
        import { join } from 'node:path';
        import { spawnSync } from 'node:child_process';
        import { DatabaseSync } from 'node:sqlite';
        const config = JSON.parse(readFileSync(process.env.FACTORY_FIXTURE, 'utf8'));
        const marker = join(config.directory, 'cancel-injected');
        if (process.argv[2] === 'thread' && process.argv[3] === 'show' && !existsSync(marker)) {
          const db = new DatabaseSync(join(config.directory, 'factory.sqlite'), { readOnly: true });
          const resolved = db.prepare("select 1 from records where name='resolution.json' limit 1").get();
          db.close();
          if (resolved) {
            const name = readdirSync(config.directory).find(n => n.startsWith('restacker') && n.endsWith('.json'));
            const path = join(config.directory, name);
            const state = JSON.parse(readFileSync(path, 'utf8'));
            state.thread.status = ${JSON.stringify(status)};
            writeFileSync(path, JSON.stringify(state));
            writeFileSync(marker, 'true');
          }
        }
        const result = spawnSync(${JSON.stringify(original)}, process.argv.slice(2), { env: process.env, stdio: 'inherit' });
        process.exit(result.status ?? 1);
      `,
        { path: f.host.binary, module: true }
      );
      for (let n = 0; n < 4; n++) await prepare(f);
      expect(await readFile(join(f.host.directory, 'cancel-injected'), 'utf8')).toBe('true');
      expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(
        status === 'completed' ? 1 : 0
      );
      expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(
        status === 'completed'
      );
      if (status !== 'completed') {
        const { path, state } = await worker(f);
        state.thread.status = 'completed';
        await writeFile(path, JSON.stringify(state));
        await prepare(f);
        expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(0);
        expect(await recoveries(f)).toContainEqual(
          expect.objectContaining({
            phase: 'manual-recovery',
            active: false,
            progress: expect.stringContaining('cancelled'),
          })
        );
      }
    } finally {
      await f.close();
    }
  }
);

it.each([1, 2])(
  'bounds an unclaimed intent overtaken by a worker run with limit %s',
  async (limit) => {
    const f = await joinFixture({
      inProcess: true,
      independentMain: true,
      automaticReview: false,
      reconciliationLimit: limit,
    });
    try {
      await configure(f, { reconcileReview: true });
      const original = `${f.host.binary}-original`;
      await rename(f.host.binary, original);
      await f.host.nodeCommand(
        't3-wrapper',
        `
      import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
      import { join } from 'node:path';
      import { spawnSync } from 'node:child_process';
      import { DatabaseSync } from 'node:sqlite';
      const config = JSON.parse(readFileSync(process.env.FACTORY_FIXTURE, 'utf8'));
      const marker = join(config.directory, 'race-injected');
      if (process.argv[2] === 'thread' && process.argv[3] === 'show' && !existsSync(marker)) {
        const db = new DatabaseSync(join(config.directory, 'factory.sqlite'), { readOnly: true });
        const reserved = db.prepare("select 1 from records where name='reconciliation-1.json' limit 1").get();
        db.close();
        if (reserved) {
          const name = readdirSync(config.directory).find(n => n.startsWith('restacker-') && n.endsWith('.json'));
          const path = join(config.directory, name);
          const state = JSON.parse(readFileSync(path, 'utf8'));
          state.thread.runCount += 1;
          state.thread.latestRunId = 'concurrent-completed-run';
          writeFileSync(path, JSON.stringify(state));
          writeFileSync(marker, 'true');
        }
      }
      const result = spawnSync(${JSON.stringify(original)}, process.argv.slice(2), { env: process.env, stdio: 'inherit' });
      process.exit(result.status ?? 1);
    `,
        { path: f.host.binary, module: true }
      );
      for (let n = 0; n < 5; n++) await prepare(f);
      expect(await readFile(join(f.host.directory, 'race-injected'), 'utf8')).toBe('true');
      expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(limit === 2);
      expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(
        limit === 2 ? 2 : 0
      );
      if (limit === 1)
        expect(await recoveries(f)).toContainEqual(
          expect.objectContaining({
            phase: 'manual-recovery',
            active: false,
            progress: expect.stringContaining('limit'),
          })
        );
    } finally {
      await f.close();
    }
  }
);

it.each([false, true])(
  'lets a later legacy response supersede prior success before migration, corrected=%s',
  async (corrected) => {
    const f = await joinFixture({ inProcess: true, independentMain: true, automaticReview: true });
    try {
      await configure(f, {
        recoveryStatus: 'running',
        reconcileReview: true,
        legacyRecoveryReply: !corrected,
      });
      await prepare(f);
      const { path, state } = await worker(f);
      state.thread.status = 'completed';
      state.messages.push({
        role: 'assistant',
        text: JSON.stringify({
          operation: state.operation,
          commit: 'f'.repeat(40),
          outcome: 'incomplete',
        }),
      });
      await writeFile(path, JSON.stringify(state));
      await configure(f, { recoveryStatus: 'completed' });
      for (let n = 0; n < 4; n++) await prepare(f);
      const sends = (await f.host.calls()).filter((c) => c.args[1] === 'send');
      expect(sends).toHaveLength(1);
      expect(sends[0]?.args[3]).toContain('Migrate once to version 1');
      expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(corrected);
      if (!corrected)
        expect(await recoveries(f)).toContainEqual(
          expect.objectContaining({ phase: 'manual-recovery', active: false })
        );
    } finally {
      await f.close();
    }
  }
);

it('accepts corrected checked and reviewed evidence from the same workers after reconciliation across reopen', async () => {
  const f = await joinFixture({ inProcess: true, independentMain: true, automaticReview: false });
  try {
    await configure(f, { reconcileReview: true });
    for (let n = 0; n < 3; n++) await prepare(f);
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(true);
    const calls = await f.host.calls();
    const starts = calls.filter((c) => c.args[1] === 'start');
    const sends = calls.filter((c) => c.args[1] === 'send');
    expect(starts).toHaveLength(2);
    expect(sends).toHaveLength(2);
    expect(new Set(sends.map((c) => c.args[2])).size).toBe(2);
    for (const c of sends) {
      expect(c.args[3]).toContain('```typescript\ntype AgentResponse =');
      expect(c.args[3]).toContain('<RESTACK>SIMPLE</RESTACK> or <RESTACK>COMPLEX</RESTACK>');
      expect(c.args[3]).toContain('reviewed must match checked');
    }
  } finally {
    await f.close();
  }
});

it('migrates old recovery responses once without consuming the zero state-attempt allowance', async () => {
  const f = await joinFixture({
    inProcess: true,
    independentMain: true,
    automaticReview: false,
    reconciliationLimit: 0,
  });
  try {
    await configure(f, { legacyRecoveryInitial: true, legacyRecoveryReply: true });
    for (let n = 0; n < 4; n++) await prepare(f);
    const sends = (await f.host.calls()).filter((c) => c.args[1] === 'send');
    expect(sends).toHaveLength(1);
    expect(sends[0]?.args[3]).toContain('Migrate once to version 1');
    expect(await recoveries(f)).toContainEqual(
      expect.objectContaining({
        phase: 'manual-recovery',
        active: false,
        progress: expect.stringContaining('migration failed'),
      })
    );
  } finally {
    await f.close();
  }
});

it('accepts a coherent migrated response, ignoring later unrelated notifications', async () => {
  const f = await joinFixture({
    inProcess: true,
    independentMain: true,
    automaticReview: false,
    reconciliationLimit: 0,
  });
  try {
    await configure(f, { legacyRecoveryInitial: true, reconcileReview: true });
    await prepare(f);
    const { path, state } = await worker(f);
    state.messages.push(
      { role: 'assistant', text: 'Delayed tool finished.' },
      { role: 'assistant', text: JSON.stringify({ event: 'notification' }) }
    );
    await writeFile(path, JSON.stringify(state));
    for (let n = 0; n < 3; n++) await prepare(f);
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(true);
    expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(2);
  } finally {
    await f.close();
  }
});

it('retains an uncertain undelivered send claim without resending or accepting an unbound successful response', async () => {
  const f = await joinFixture({ inProcess: true, independentMain: true, automaticReview: false });
  try {
    await configure(f, { dropRecoverySend: true });
    await expect(prepare(f)).rejects.toMatchObject({ _tag: 'Unavailable' });
    const { path, state } = await worker(f);
    const prior = JSON.parse(state.messages.at(-1).text);
    state.thread.runCount += 10;
    state.thread.latestRunId = 'unrelated-wake';
    state.messages.push({
      role: 'assistant',
      text: JSON.stringify({ ...prior, reviewed: prior.checked }),
    });
    await writeFile(path, JSON.stringify(state));
    for (let n = 0; n < 3; n++) await prepare(f);
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(false);
    expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(1);
    expect((await f.host.calls()).filter((c) => c.args[1] === 'start')).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it('reconciles delivered but unacknowledged transport outcomes after reopening without duplicate sends', async () => {
  const f = await joinFixture({ inProcess: true, independentMain: true, automaticReview: false });
  try {
    await configure(f, { loseRecoverySend: true, reconcileReview: true });
    await expect(prepare(f)).rejects.toMatchObject({ _tag: 'Unavailable' });
    await expect(prepare(f)).rejects.toMatchObject({ _tag: 'Unavailable' });
    await prepare(f);
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(true);
    expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(2);
    expect((await f.host.calls()).filter((c) => c.args[1] === 'start')).toHaveLength(2);
  } finally {
    await f.close();
  }
});

it.each(['active', 'wait', 'watch'] as const)(
  'does not spend attempts or send while a recursive descendant has an outstanding %s',
  async (kind) => {
    const f = await joinFixture({
      inProcess: true,
      independentMain: true,
      automaticReview: false,
      reconciliationLimit: 1,
    });
    try {
      await configure(f, { recoveryStatus: 'running' });
      await prepare(f);
      const { path, state } = await worker(f);
      state.thread.status = 'completed';
      await writeFile(path, JSON.stringify(state));
      await configure(f, {
        descendants: [
          { threadId: 'parent-reviewer', parentThreadId: state.thread.threadId },
          { threadId: 'leaf-reviewer', parentThreadId: 'parent-reviewer' },
        ],
        descendantSnapshots: {
          'leaf-reviewer':
            kind === 'active'
              ? { status: 'running', activeRunId: 'leaf-run' }
              : kind === 'wait'
                ? { blockedOnThreadWait: true }
                : { pullRequests: [{ watching: true }] },
        },
      });
      for (let n = 0; n < 2; n++) await prepare(f);
      expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(0);
      await configure(f, { descendants: [], descendantSnapshots: {} });
      await prepare(f);
      await prepare(f);
      expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(1);
      expect(await recoveries(f)).toContainEqual(
        expect.objectContaining({
          phase: 'manual-recovery',
          active: false,
          progress: expect.stringContaining('limit'),
        })
      );
    } finally {
      await f.close();
    }
  }
);

it('retains cancellation across worker observations and restart without launching or sending again', async () => {
  const f = await joinFixture({ inProcess: true, independentMain: true, automaticReview: false });
  try {
    await configure(f, { recoveryStatus: 'cancelled' });
    await prepare(f);
    const { path, state } = await worker(f);
    state.thread.status = 'completed';
    await writeFile(path, JSON.stringify(state));
    await prepare(f);
    await prepare(f);
    expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(0);
    expect((await f.host.calls()).filter((c) => c.args[1] === 'start')).toHaveLength(1);
    expect(await recoveries(f)).toContainEqual(
      expect.objectContaining({
        phase: 'manual-recovery',
        active: false,
        progress: expect.stringContaining('cancelled'),
      })
    );
  } finally {
    await f.close();
  }
});

it('uses the shared budget for missing evidence in the subsequent independent review phase', async () => {
  const f = await joinFixture({
    inProcess: true,
    conflict: true,
    reconciliationLimit: 1,
    restack: { outcome: 'SIMPLE', review: false },
  });
  try {
    for (let n = 0; n < 4; n++) await prepare(f);
    const sends = (await f.host.calls()).filter((c) => c.args[1] === 'send');
    expect(sends).toHaveLength(2);
    expect(sends[1]?.args[3]).toContain(':review. Restack reconciliation');
    expect(await recoveries(f)).toContainEqual(
      expect.objectContaining({ phase: 'manual-recovery', active: false })
    );
  } finally {
    await f.close();
  }
});

it.each(['base', 'checked', 'checks'] as const)(
  'does not accept corrected review evidence with an invalid %s',
  async (field) => {
    const f = await joinFixture({
      inProcess: true,
      independentMain: true,
      automaticReview: false,
      reconciliationLimit: 0,
    });
    try {
      await configure(f, { recoveryStatus: 'running' });
      await prepare(f);
      const { path, state } = await worker(f);
      const prior = JSON.parse(state.messages.at(-1).text);
      state.thread.status = 'completed';
      const invalid = {
        ...prior,
        reviewed: prior.checked,
        [field]: field === 'checks' ? { ...prior.checks, tests: false } : f.host.base,
      };
      state.messages.push(
        { role: 'assistant', text: JSON.stringify({ ...prior, reviewed: prior.checked }) },
        { role: 'assistant', text: JSON.stringify(invalid) },
        { role: 'assistant', text: 'Delayed completion' }
      );
      await writeFile(path, JSON.stringify(state));
      await prepare(f);
      expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(false);
      expect(await recoveries(f)).toContainEqual(
        expect.objectContaining({ phase: 'manual-recovery', active: false })
      );
    } finally {
      await f.close();
    }
  }
);

it.each([false, true])(
  'reconciles an uncertain initial review delivery only from its actual instruction, delivered=%s',
  async (delivered) => {
    const f = await joinFixture({
      inProcess: true,
      conflict: true,
      restack: { outcome: 'SIMPLE', review: true },
    });
    try {
      await configure(
        f,
        delivered ? { loseInitialReviewSend: true } : { dropInitialReviewSend: true }
      );
      await prepare(f);
      await expect(prepare(f)).rejects.toMatchObject({ _tag: 'Unavailable' });
      for (let n = 0; n < 3; n++) await prepare(f);
      expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(delivered);
      expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(1);
    } finally {
      await f.close();
    }
  }
);

it('retains the consumed state budget from resolution into independent review', async () => {
  const f = await joinFixture({
    inProcess: true,
    conflict: true,
    reconciliationLimit: 1,
    restack: { outcome: 'SIMPLE', review: false },
  });
  try {
    await configure(f, { omitRecoveryClassification: true });
    for (let n = 0; n < 5; n++) await prepare(f);
    const sends = (await f.host.calls()).filter((c) => c.args[1] === 'send');
    expect(sends).toHaveLength(2);
    expect(sends.filter((c) => c.args[3].includes('Restack reconciliation '))).toHaveLength(1);
    expect(await recoveries(f)).toContainEqual(
      expect.objectContaining({
        phase: 'manual-recovery',
        active: false,
        progress: expect.stringContaining('limit'),
      })
    );
  } finally {
    await f.close();
  }
});
it('does not migrate a second time when the later review response is also old-format', async () => {
  const f = await joinFixture({
    inProcess: true,
    conflict: true,
    restack: { outcome: 'SIMPLE', review: true },
  });
  try {
    await configure(f, { legacyRecoveryInitial: true, legacyReviewReply: true });
    for (let n = 0; n < 5; n++) await prepare(f);
    const sends = (await f.host.calls()).filter((c) => c.args[1] === 'send');
    expect(sends).toHaveLength(2);
    expect(sends.filter((c) => c.args[3].includes('Migrate once to version 1'))).toHaveLength(1);
    expect(await recoveries(f)).toContainEqual(
      expect.objectContaining({
        phase: 'manual-recovery',
        active: false,
        progress: expect.stringContaining('migration failed'),
      })
    );
  } finally {
    await f.close();
  }
});

it('does not transfer a pending reconciliation to a replacement thread with copied valid evidence', async () => {
  const f = await joinFixture({ inProcess: true, independentMain: true, automaticReview: false });
  try {
    await prepare(f);
    const { path, state } = await worker(f);
    const response = JSON.parse(state.messages.at(-1).text);
    state.requestedThreadId = 'restacker-replaced';
    state.thread.threadId = 'restacker-replaced';
    state.thread.latestRunId = 'replacement-run';
    state.thread.runCount += 2;
    state.messages.push({
      role: 'assistant',
      text: JSON.stringify({ ...response, reviewed: response.checked }),
    });
    await writeFile(path, JSON.stringify(state));
    await prepare(f);
    await prepare(f);
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(false);
    expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(1);
    expect(await recoveries(f)).toContainEqual(
      expect.objectContaining({
        phase: 'manual-recovery',
        active: false,
        progress: expect.stringContaining('owning worker changed'),
      })
    );
  } finally {
    await f.close();
  }
});
