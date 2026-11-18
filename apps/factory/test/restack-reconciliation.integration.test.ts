import { readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { joinFixture } from './fixtures/join.js';
it('retries recovery preparation after a capability failure without claiming an external launch', async () => {
  const execution = {
    model: 'gpt-6.2-sol',
    effort: 'high',
    mode: 'fast' as const,
    permissionLevel: 'auto' as const,
  };
  const f = await joinFixture({
    inProcess: true,
    conflict: true,
    restack: { outcome: 'SIMPLE', review: true },
    readExecution: async () => execution,
  });
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    const configuration = JSON.parse(await readFile(f.host.configFile, 'utf8'));
    await f.host.save({
      ...configuration,
      executionCatalog: {
        runtimeMode: 'full-access',
        providers: [
          { providerInstanceId: 'codex', constraints: ['Temporarily unavailable'], models: [] },
        ],
      },
    });
    await Effect.runPromise(
      (f.reopen().prepare?.(5) ?? Effect.void).pipe(Effect.catch(() => Effect.void))
    );
    expect((await f.host.calls()).filter((c) => c.args[1] === 't3_thread_launch')).toHaveLength(0);
    await f.host.save(configuration);
    await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    expect((await f.host.calls()).filter((c) => c.args[1] === 't3_thread_launch')).toHaveLength(1);
  } finally {
    await f.close();
  }
});
it('retains configured recovery execution across restart and uses it for fresh independent reviews', async () => {
  let execution = {
    model: 'gpt-6.2-sol',
    effort: 'high',
    mode: 'fast' as const,
    permissionLevel: 'auto' as const,
  };
  const original = execution;
  const f = await joinFixture({
    inProcess: true,
    conflict: true,
    restack: { outcome: 'SIMPLE', review: true },
    readExecution: async () => execution,
  });
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    execution = { ...execution, model: 'gpt-6.1-sol' };
    await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    const calls = await f.host.calls();
    const launches = calls.filter((c) => c.args[1] === 't3_thread_launch');
    expect(launches).toHaveLength(1);
    expect(JSON.parse(launches[0].args[2])).toMatchObject({
      modelSelection: { model: original.model },
      runtimeMode: 'auto',
    });
    const review = calls.find((c) => c.args[1] === 'send');
    expect(review?.args[3]).toContain('Codex model gpt-6.2-sol');
    expect(review?.args[3]).toContain("serviceTier: 'priority'");
  } finally {
    await f.close();
  }
});

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

it.each(['state', 'dependencies', 'legacy', 'notification'])(
  'keeps latest $0 recovery evidence coherent across malformed input and restart',
  async (kind) => {
    const f = await joinFixture({
      inProcess: true,
      independentMain: true,
      automaticReview: false,
      reconciliationLimit: 1,
    });
    try {
      await configure(f, { recoveryStatus: 'running', reconcileReview: true });
      await prepare(f);
      const { path, state } = await worker(f);
      const earlier = state.messages.at(-1);
      const proof = JSON.parse(earlier.text);
      earlier.text = JSON.stringify({ ...proof, reviewed: proof.checked });
      state.thread.status = 'completed';
      state.messages.push({
        role: 'assistant',
        text:
          kind === 'notification'
            ? '{"kind":"notification'
            : kind === 'legacy'
              ? `{"operation":${JSON.stringify(state.operation)},"outcome":`
              : kind === 'dependencies'
                ? '{"version":1,"kind":"dependencies","requireUnimplementedIssues":["758"],'
                : '{"version":1,"kind":"state","checks":{"lint":false},',
      });
      await writeFile(path, JSON.stringify(state));
      await configure(f, { recoveryStatus: 'completed' });
      await prepare(f);
      const ownSends = (await f.host.calls()).filter(
        (call) => call.args[1] === 'send' && call.args[2] === state.thread.threadId
      );
      expect(ownSends).toHaveLength(kind === 'notification' ? 0 : 1);
      if (kind !== 'notification')
        expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(false);
      for (let attempt = 0; attempt < 3; attempt++) await prepare(f);
      expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(true);
      const calls = await f.host.calls();
      expect(calls.filter((call) => call.args[1] === 'start')).toHaveLength(2);
      expect(calls.filter((call) => call.args[1] === 'send')).toHaveLength(
        kind === 'notification' ? 1 : 2
      );
      expect(
        calls.filter((call) => call.args[1] === 'send' && call.args[2] === state.thread.threadId)
      ).toHaveLength(kind === 'notification' ? 0 : 1);
    } finally {
      await f.close();
    }
  }
);

it('retains the accepted classification while an independent review child is busy without accepting incomplete review', async () => {
  const f = await joinFixture({
    inProcess: true,
    conflict: true,
    restack: { outcome: 'COMPLEX', review: false },
  });
  try {
    await prepare(f);
    await prepare(f);
    const { state } = await worker(f);
    await configure(f, {
      descendants: [{ threadId: 'pending-reviewer', parentThreadId: state.thread.threadId }],
      descendantSnapshots: { 'pending-reviewer': { status: 'running', activeRunId: 'review-run' } },
    });
    await prepare(f);
    expect(await recoveries(f)).toContainEqual(
      expect.objectContaining({
        classification: 'COMPLEX',
        progress: 'Awaiting independent review-loop',
      })
    );
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(false);
    expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(1);
    const pending = await worker(f);
    pending.state.thread.status = 'waiting';
    pending.state.thread.pendingRequestCount = 1;
    await writeFile(pending.path, JSON.stringify(pending.state));
    await prepare(f);
    expect(await recoveries(f)).toContainEqual(
      expect.objectContaining({
        question: 'Open recovery thread to answer the pending question',
        active: false,
      })
    );
  } finally {
    await f.close();
  }
});

it.each([false, true].flatMap((replace) => [false, true].map((legacy) => ({ replace, legacy }))))(
  'retains the resolution owner before review, replacement=$replace legacy journal=$legacy',
  async ({ replace, legacy }) => {
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
        const marker = join(config.directory, 'owner-injected');
        if (process.argv[2] === 'thread' && process.argv[3] === 'show' && !existsSync(marker)) {
          const db = new DatabaseSync(join(config.directory, 'factory.sqlite'));
          const resolved = db.prepare("select 1 from records where name='resolution.json' limit 1").get();
          if (resolved && ${legacy}) db.prepare("delete from records where name='worker.json'").run();
          db.close();
          if (resolved) {
            const name = readdirSync(config.directory).find(n => n.startsWith('restacker') && n.endsWith('.json'));
            const path = join(config.directory, name);
            const state = JSON.parse(readFileSync(path, 'utf8'));
            if (${replace}) {
              state.requestedThreadId = 'restacker-replaced';
              state.thread.threadId = 'restacker-replaced';
            }
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
      expect(await readFile(join(f.host.directory, 'owner-injected'), 'utf8')).toBe('true');
      const sends = (await f.host.calls()).filter((c) => c.args[1] === 'send');
      expect(sends.map((c) => c.args[2])).toEqual(replace ? [] : ['restacker']);
      expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(!replace);
      if (replace)
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
  }
);

it.each(
  ['completed', 'cancelled', 'rolled_back'].flatMap((status) =>
    ['show', 'activity'].map((boundary) => ({ status, boundary }))
  )
)(
  'gates the initial review effect after resolution when its worker becomes $status at $boundary',
  async ({ status, boundary }) => {
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
        const boundary = ${JSON.stringify(boundary)};
        const observed = boundary === 'show'
          ? process.argv[2] === 'thread' && process.argv[3] === 'show'
          : process.argv[2] === 'acp-mcp-call' && process.argv[3] === 't3_thread_read';
        if (observed && !existsSync(marker)) {
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

it.each(
  [1, 2].flatMap((limit) =>
    ['completed', 'cancelled', 'rolled_back'].map((status) => ({ limit, status }))
  )
)(
  'bounds an unclaimed intent with limit $limit after observing $status',
  async ({ limit, status }) => {
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
          state.thread.status = ${JSON.stringify(status)};
          if (state.thread.status === 'completed') {
            state.thread.runCount += 1;
            state.thread.latestRunId = 'concurrent-completed-run';
          }
          writeFileSync(path, JSON.stringify(state));
          writeFileSync(marker, 'true');
        }
      }
      const result = spawnSync(${JSON.stringify(original)}, process.argv.slice(2), { env: process.env, stdio: 'inherit' });
      process.exit(result.status ?? 1);
    `,
        { path: f.host.binary, module: true }
      );
      await prepare(f);
      const { path, state } = await worker(f);
      state.thread.status = 'completed';
      await writeFile(path, JSON.stringify(state));
      for (let n = 0; n < 4; n++) await prepare(f);
      expect(await readFile(join(f.host.directory, 'race-injected'), 'utf8')).toBe('true');
      const ready = status === 'completed' && limit === 2;
      expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(ready);
      expect((await f.host.calls()).filter((c) => c.args[1] === 'send')).toHaveLength(
        ready ? 2 : 0
      );
      if (!ready)
        expect(await recoveries(f)).toContainEqual(
          expect.objectContaining({
            phase: 'manual-recovery',
            active: false,
            progress: expect.stringContaining(status === 'completed' ? 'limit' : 'cancelled'),
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

it.each(['prose', 'malformed', 'invalid-version-one', 'supported-negative'] as const)(
  'requires supported recovery evidence after the migration instruction: %s',
  async (kind) => {
    const f = await joinFixture({
      inProcess: true,
      independentMain: true,
      automaticReview: false,
      reconciliationLimit: 2,
    });
    try {
      await configure(f, { legacyRecoveryInitial: true, legacyRecoveryReply: true });
      await prepare(f);
      const { path, state } = await worker(f);
      const reply = state.messages.at(-1);
      reply.text =
        kind === 'prose'
          ? 'I could not complete migration.'
          : kind === 'malformed'
            ? '{"version":1,"kind":"state",'
            : kind === 'invalid-version-one'
              ? JSON.stringify({ version: 1, kind: 'state', jobId: state.operation })
              : JSON.stringify({
                  version: 1,
                  kind: 'state',
                  jobId: state.operation,
                  implemented: state.implemented,
                  base: state.onto,
                  checked: state.head,
                  reviewed: state.head,
                  checks: { format: true, lint: true, tests: false, coverage: true, crap: true },
                });
      await writeFile(path, JSON.stringify(state));
      await configure(f, { legacyRecoveryReply: false, reconcileReview: true });
      await prepare(f);
      const ownSends = (await f.host.calls()).filter(
        (call) => call.args[1] === 'send' && call.args[2] === state.thread.threadId
      );
      expect(ownSends).toHaveLength(kind === 'supported-negative' ? 2 : 1);
      expect(ownSends[0]?.args[3]).toContain('Migrate once to version 1');
      if (kind === 'supported-negative') {
        expect(ownSends[1]?.args[3]).toContain('Reconcile the inconsistent current recovery state');
      } else {
        expect(await recoveries(f)).toContainEqual(
          expect.objectContaining({
            phase: 'manual-recovery',
            active: false,
            progress: expect.stringContaining('migration failed'),
          })
        );
        await prepare(f);
        expect(
          (await f.host.calls()).filter(
            (call) => call.args[1] === 'send' && call.args[2] === state.thread.threadId
          )
        ).toHaveLength(1);
        expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(false);
      }
    } finally {
      await f.close();
    }
  }
);
