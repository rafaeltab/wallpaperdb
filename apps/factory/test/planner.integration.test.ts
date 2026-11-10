import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { t3Planner } from '../src/adapters/t3/index.js';
import { protocol } from './fixtures/setup.js';
it('translates a bound assistant proposal and rejects malformed or user messages', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  const proposal = {
    selected: [{ issue: 580, reason: 'Thin end-to-end preview', dependsOn: [], conflicts: [] }],
    deferred: [],
  };
  try {
    const adapter = t3Planner({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
      stateDirectory: `${host.directory}/planner-state`,
    });
    const input = {
      issues: [
        {
          metadata: {
            number: 580,
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
            title: 'Preview',
            open: true,
            candidate: true,
            labels: ['ready-for-agent'],
            assignees: [],
            projectStatus: null,
            projectPriority: null,
            projectSize: null,
            commentCount: 1,
            blockers: [],
            parents: [],
            pullRequests: [],
          },
          number: 580,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
          title: 'Large spec context',
          body: 'x'.repeat(15000),
          author: 'rafaeltab',
          open: true,
          labels: ['ready-for-agent'],
          comments: [{ author: 'rafaeltab', body: 'Preview only; preserve this scope' }],
          blockers: [577],
          parents: [571],
          blockersReady: true,
          prerequisiteEvidence: 'Verified prerequisite commit and independent reviews',
        },
      ],
      job: {
        kind: 'job' as const,
        intent: {
          id: 'parked',
          issue: 579,
          issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/579',
          base: 'a'.repeat(40),
          context: 'Existing implementation scope',
          branch: 'factory/579',
          createdAt: 0,
          expectedStage: 'implementation' as const,
        },
        execution: { kind: 'absent' as const },
        elapsedMs: 100,
        resume: { index: 0, questionId: 'pending-question' },
      },
      capacity: { concurrency: 1 as const, admission: 1 as const },
    };
    await host.save({ planner: { proposal } });
    expect(await Effect.runPromise(adapter.propose(input))).toEqual(proposal);
    expect(
      JSON.parse(await readFile(`${host.directory}/planner.json`, 'utf8')).prompt
    ).not.toContain('Preview only; preserve this scope');
    const sent = JSON.parse(await readFile(`${host.directory}/planner.json`, 'utf8')).prompt;
    expect(sent).toContain('# Running issues\n\n- #579: parked');
    for (const patch of [
      { role: 'user' },
      { malformed: true },
      { status: 'failed' },
      { responseRequestId: 'stale-request' },
    ]) {
      await host.save({ planner: { proposal, ...patch } });
      await expect(Effect.runPromise(adapter.propose(input))).rejects.toMatchObject({
        _tag: 'Unavailable',
      });
    }
    await host.save({ planner: { proposal, status: 'running' } });
    const observations = (await host.calls()).filter((call) => call.args[1] === 'show').length;
    const abort = new AbortController();
    const pending = Effect.runPromise(adapter.propose(input), { signal: abort.signal });
    await Promise.all([
      expect(pending).rejects.toBeDefined(),
      (async () => {
        try {
          await expect
            .poll(async () => (await host.calls()).filter((call) => call.args[1] === 'show').length)
            .toBeGreaterThan(observations);
        } finally {
          abort.abort();
        }
      })(),
    ]);
    const starts = (await host.calls()).filter((call) => call.args[1] === 'start').length;
    await expect(
      Effect.runPromise(
        t3Planner({
          binary: host.binary,
          project: host.repository,
          projectId: 'project-id',
          ...host.mcp,
          stateDirectory: `${host.directory}/planner-state`,
        }).propose(input),
        { signal: AbortSignal.timeout(5000) }
      )
    ).rejects.toMatchObject({
      _tag: 'Unavailable',
      cause: expect.objectContaining({ message: 'Previous advisory planner is still outstanding' }),
    });
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(starts);
    await host.save({ planner: { proposal, status: 'completed', runId: 'unrelated-run' } });
    await expect(Effect.runPromise(adapter.propose(input))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(starts);
    await host.save({ planner: { proposal, status: 'completed' } });
    const changed = { ...input, capacity: { concurrency: 2, admission: 1 } };
    expect(await Effect.runPromise(adapter.propose(changed))).toEqual(proposal);
    expect(JSON.parse(await readFile(`${host.directory}/planner.json`, 'utf8')).capacity).toEqual(
      changed.capacity
    );
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(
      starts + 1
    );
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it('retains uncertain launch responsibility after a lost start response', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    await host.save({ planner: { lostStart: true } });
    const adapter = t3Planner({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
      stateDirectory: `${host.directory}/planner-state`,
    });
    const input = {
      issues: [],
      job: { kind: 'empty' as const },
      capacity: { concurrency: 1 as const, admission: 1 as const },
    };
    await expect(Effect.runPromise(adapter.propose(input))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    expect(
      JSON.parse(await readFile(`${host.directory}/planner.json`, 'utf8')).prompt
    ).not.toContain('Preview only; preserve this scope');
    await host.save({ planner: { proposal: { selected: [], deferred: [] } } });
    await expect(
      Effect.runPromise(
        t3Planner({
          binary: host.binary,
          project: host.repository,
          projectId: 'project-id',
          ...host.mcp,
          stateDirectory: `${host.directory}/planner-state`,
        }).propose(input)
      )
    ).rejects.toMatchObject({
      _tag: 'Unavailable',
      cause: expect.objectContaining({
        message: 'Planner launch is uncertain; operator reconciliation required',
      }),
    });
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it('returns Unavailable when the planner exits before consuming large context', async () => {
  const host = await protocol();
  try {
    await writeFile(host.binary, '#!/bin/sh\nexit 1\n');
    const adapter = t3Planner({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
      stateDirectory: `${host.directory}/planner-state`,
    });
    await expect(
      Effect.runPromise(
        adapter.propose({
          issues: [
            {
              metadata: {
                number: 580,
                url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
                title: 'Preview',
                open: true,
                candidate: true,
                labels: ['ready-for-agent'],
                assignees: [],
                projectStatus: null,
                projectPriority: null,
                projectSize: null,
                commentCount: 1,
                blockers: [],
                parents: [],
                pullRequests: [],
              },
              number: 580,
              url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
              title: 'Large context',
              body: 'x'.repeat(150000),
              author: 'rafaeltab',
              open: true,
              labels: ['ready-for-agent'],
              comments: [],
              parents: [],
              blockers: [],
              blockersReady: true,
              prerequisiteEvidence: '',
            },
          ],
          job: { kind: 'empty' },
          capacity: { concurrency: 1, admission: 1 },
        })
      )
    ).rejects.toMatchObject({ _tag: 'Unavailable' });
  } finally {
    await host.cleanup();
  }
});

it('bounds one outstanding advisory request across polling iterations and concurrent callers', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  const abort = new AbortController();
  try {
    await host.save({ planner: { status: 'running', proposal: { selected: [], deferred: [] } } });
    const adapter = t3Planner({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
      stateDirectory: `${host.directory}/planner-state`,
    });
    const input = {
      issues: [],
      job: { kind: 'empty' as const },
      capacity: { concurrency: 1, admission: 1 },
    };
    const pending = Effect.runPromise(adapter.propose(input), { signal: abort.signal });
    await Promise.all([
      expect(pending).rejects.toBeDefined(),
      (async () => {
        try {
          await vi.waitFor(
            async () =>
              expect(
                (await host.calls()).filter((call) => call.args[1] === 'show').length
              ).toBeGreaterThanOrEqual(2),
            { timeout: 5000, interval: 30 }
          );
          await expect(Effect.runPromise(adapter.propose(input))).rejects.toMatchObject({
            _tag: 'Unavailable',
            cause: expect.objectContaining({ message: 'Planner request already in progress' }),
          });
          expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
        } finally {
          abort.abort();
        }
      })(),
    ]);
  } finally {
    abort.abort();
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it('reserves one durable launch across competing planner adapters', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    await host.save({ planner: { lostStart: true } });
    const config = {
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
      stateDirectory: `${host.directory}/planner-state`,
    };
    const input = {
      issues: [],
      job: { kind: 'empty' as const },
      capacity: { concurrency: 1, admission: 1 },
    };
    const outcomes = await Promise.allSettled([
      Effect.runPromise(t3Planner(config).propose(input)),
      Effect.runPromise(t3Planner(config).propose(input)),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it.each(['{', JSON.stringify({ revision: 1, requestId: 'saved', input: '{}', deadline: 0 })])(
  'fails closed on corrupt durable planner state %s',
  async (record) => {
    const host = await protocol();
    try {
      const directory = `${host.directory}/planner-state`;
      await mkdir(directory);
      await writeFile(`${host.directory}/calls.jsonl`, '');
      await writeFile(`${directory}/planner-0.json`, record);
      const adapter = t3Planner({
        binary: host.binary,
        project: host.repository,
        projectId: 'project-id',
        ...host.mcp,
        stateDirectory: directory,
      });
      await expect(
        Effect.runPromise(
          adapter.propose({
            issues: [],
            job: { kind: 'empty' },
            capacity: { concurrency: 1, admission: 1 },
          })
        )
      ).rejects.toMatchObject({ _tag: 'Unavailable' });
      expect(await host.calls()).toEqual([]);
    } finally {
      await host.cleanup();
    }
  }
);

it('retires a confirmed validation rejection and permits a fresh normal proposal', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const config = {
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
      stateDirectory: `${host.directory}/planner-state`,
    };
    const input = {
      issues: [],
      job: { kind: 'empty' as const },
      capacity: { concurrency: 1, admission: 1 },
    };
    await host.save({ planner: { rejectStart: true } });
    await expect(Effect.runPromise(t3Planner(config).propose(input))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    await host.save({ planner: { proposal: { selected: [], deferred: [] } } });
    expect(await Effect.runPromise(t3Planner(config).propose(input))).toEqual({
      selected: [],
      deferred: [],
    });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it('rejects an oversized prompt before launch intent and retains a useful terminal outcome', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    await writeFile(`${host.directory}/calls.jsonl`, '');
    await host.save({ planner: { proposal: { selected: [], deferred: [] } } });
    const config = {
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
      stateDirectory: `${host.directory}/planner-state`,
    };
    const input = {
      issues: [
        {
          metadata: {
            number: 580,
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
            title: 'Preview',
            open: true,
            candidate: true,
            labels: ['ready-for-agent'],
            assignees: [],
            projectStatus: null,
            projectPriority: null,
            projectSize: null,
            commentCount: 1,
            blockers: [],
            parents: [],
            pullRequests: [],
          },
          number: 580,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
          title: 'x'.repeat(120001),
          body: 'Omitted body',
          author: 'rafaeltab',
          open: true,
          labels: ['ready-for-agent'],
          comments: [],
          parents: [],
          blockers: [],
          blockersReady: true,
          prerequisiteEvidence: '',
        },
      ],
      job: { kind: 'empty' as const },
      capacity: { concurrency: 1, admission: 1 },
    };
    await expect(Effect.runPromise(t3Planner(config).propose(input))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    const { plannerState } = await import('../src/adapters/t3/index.js');
    expect(await plannerState(config.stateDirectory).read()).toMatchObject({
      revision: 0,
      phase: 'failed',
      retired: true,
      detail: expect.stringContaining('maximum is 120000'),
    });
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(0);
    expect(await Effect.runPromise(t3Planner(config).propose({ ...input, issues: [] }))).toEqual({
      selected: [],
      deferred: [],
    });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it('reconciles late completion after the original deadline but retains active bound and uncertain unbound ownership', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const { plannerState } = await import('../src/adapters/t3/index.js');
    const config = {
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
      stateDirectory: `${host.directory}/planner-state`,
    };
    const journal = plannerState(config.stateDirectory);
    const input = {
      issues: [],
      job: { kind: 'empty' as const },
      capacity: { concurrency: 1, admission: 1 },
    };
    const requestId = 'legacy-bound';
    await writeFile(`${host.directory}/planner.json`, JSON.stringify({ requestId, input }));
    await journal.save({
      revision: 0,
      requestId,
      input: JSON.stringify(input),
      deadline: Date.now() - 100,
      run: { threadId: 'planner-thread', runId: 'planner-run' },
      phase: 'running',
    });
    await host.save({ planner: { status: 'running', proposal: { selected: [], deferred: [] } } });
    expect(await Effect.runPromise(t3Planner(config).ownership())).toMatchObject({
      requestId,
      deadline: expect.any(Number),
      run: { runId: 'planner-run' },
    });
    expect((await journal.read())?.retired).not.toBe(true);
    await host.save({ planner: { status: 'completed', proposal: { selected: [], deferred: [] } } });
    expect(await Effect.runPromise(t3Planner(config).ownership())).toMatchObject({
      requestId,
      retired: true,
      phase: 'succeeded',
    });
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(0);
    expect(await Effect.runPromise(t3Planner(config).propose(input))).toEqual({
      selected: [],
      deferred: [],
    });
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it('replays the same retired bound proposal across the proposal-to-freshness crash gap without another launch', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const { plannerState } = await import('../src/adapters/t3/index.js');
    const config = {
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
      stateDirectory: `${host.directory}/planner-state`,
    };
    const input = {
      issues: [],
      job: { kind: 'empty' as const },
      capacity: { concurrency: 1, admission: 1 },
    };
    const attempt = { requestId: 'same-attempt', deadline: Date.now() + 60000 };
    await host.save({ planner: { proposal: { selected: [], deferred: [] } } });
    expect(await Effect.runPromise(t3Planner(config).propose(input, attempt))).toEqual({
      selected: [],
      deferred: [],
    });
    const saved = await plannerState(config.stateDirectory).read();
    expect(saved).toMatchObject({
      requestId: attempt.requestId,
      deadline: attempt.deadline,
      retired: true,
      run: { threadId: 'planner-thread', runId: 'planner-run' },
    });
    expect(await Effect.runPromise(t3Planner(config).propose(input, attempt))).toEqual({
      selected: [],
      deferred: [],
    });
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
    await expect(
      Effect.runPromise(t3Planner(config).propose({ ...input, paused: true }, attempt))
    ).rejects.toMatchObject({ _tag: 'Unavailable' });
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it.each([
  { operation: 'reconcile', cancel: false },
  { operation: 'ownership', cancel: false },
  { operation: 'reconcile', cancel: true },
] as const)(
  'recovers the same attempt while background $operation is observing its retained run, cancel wait $cancel',
  async ({ operation, cancel }) => {
    const host = await protocol(),
      previous = process.env.FACTORY_FIXTURE;
    process.env.FACTORY_FIXTURE = host.configFile;
    const abort = new AbortController(),
      requestAbort = new AbortController(),
      pending: Promise<unknown>[] = [];
    try {
      const { plannerState } = await import('../src/adapters/t3/index.js');
      const config = {
        binary: host.binary,
        project: host.repository,
        projectId: 'project-id',
        ...host.mcp,
        stateDirectory: `${host.directory}/planner-state`,
      };
      const input = {
        issues: [],
        job: { kind: 'empty' as const },
        capacity: { concurrency: 1, admission: 1 },
      };
      const attempt = { requestId: 'resuming-same-attempt', deadline: Date.now() + 60000 },
        run = { threadId: 'planner-thread', runId: 'planner-run' },
        proposal = { selected: [], deferred: [] };
      await plannerState(config.stateDirectory).save({
        revision: 0,
        requestId: attempt.requestId,
        input: JSON.stringify(input),
        deadline: attempt.deadline,
        run,
        phase: 'running',
      });
      await writeFile(`${host.directory}/planner.json`, JSON.stringify({ ...attempt, input }));
      await host.save({
        holds: ['planner-observation'],
        planner: { status: 'completed', proposal },
      });
      const adapter = t3Planner(config);
      const background = Effect.runPromise(adapter[operation](), { signal: abort.signal }).then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
      pending.push(background);
      await vi.waitFor(
        async () =>
          expect(await readFile(`${host.directory}/held-planner-observation`, 'utf8')).toBe(
            'planner-observation'
          ),
        { timeout: 5000, interval: 20 }
      );
      let resumed = Effect.runPromise(adapter.propose(input, attempt), {
        signal: requestAbort.signal,
      }).then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
      pending.push(resumed);
      expect(await Effect.runPromise(adapter.ownership(false, attempt.requestId))).toMatchObject({
        requestId: attempt.requestId,
        deadline: attempt.deadline,
        run,
      });
      if (cancel) {
        requestAbort.abort();
        expect(await resumed).toHaveProperty('error');
        // Cancellation releases only this caller. Background ownership remains intact.
        resumed = Effect.runPromise(adapter.propose(input, attempt), { signal: abort.signal }).then(
          (value) => ({ value }),
          (error: unknown) => ({ error })
        );
        pending.push(resumed);
      }
      await writeFile(`${host.directory}/release-planner-observation`, 'continue');
      expect(await resumed).toEqual({ value: proposal });
      expect(await background).not.toHaveProperty('error');
      expect(await plannerState(config.stateDirectory).read()).toMatchObject({
        requestId: attempt.requestId,
        deadline: attempt.deadline,
        run,
        retired: true,
        settled: true,
      });
      expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(0);
    } finally {
      requestAbort.abort();
      abort.abort();
      await writeFile(`${host.directory}/release-planner-observation`, 'cleanup');
      await Promise.allSettled(pending);
      if (previous === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous;
      await host.cleanup();
    }
  }
);

it('reattaches an exact bound attempt when only incidental job elapsed time advanced', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const config = {
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
      stateDirectory: `${host.directory}/planner-state`,
    };
    const job = {
      kind: 'job' as const,
      intent: {
        id: 'parked',
        issue: 579,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/579',
        base: 'a'.repeat(40),
        context: 'Existing scope',
        branch: 'factory/579',
        createdAt: 0,
        expectedStage: 'implementation' as const,
      },
      execution: { kind: 'absent' as const },
      elapsedMs: 100,
    };
    const input = { issues: [], job, jobs: [job], capacity: { concurrency: 1, admission: 1 } };
    const attempt = { requestId: 'same-attempt', deadline: Date.now() + 60000 };
    await host.save({ planner: { proposal: { selected: [], deferred: [] } } });
    await Effect.runPromise(t3Planner(config).propose(input, attempt));
    expect(
      await Effect.runPromise(
        t3Planner(config).propose(
          { ...input, job: { ...job, elapsedMs: 900 }, jobs: [{ ...job, elapsedMs: 900 }] },
          attempt
        )
      )
    ).toEqual({ selected: [], deferred: [] });
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it('sends the complete flat metadata index over stdin without bodies or duplicate jobs', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const makeIssue = (number: number, candidate: boolean) => ({
      number,
      url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
      title: `Full title ${number}: quotes " slash \\ newline\nUnicode café 🖼️`,
      body: 'PRIVATE_BODY_SENTINEL',
      author: 'rafaeltab',
      open: true,
      labels: ['ready-for-agent'],
      comments: [{ author: 'rafaeltab', body: 'PRIVATE_COMMENT_SENTINEL' }],
      blockers: number === 1 ? [2] : [],
      parents: [3],
      blockersReady: true,
      prerequisiteEvidence: 'PRIVATE_EVIDENCE_SENTINEL',
      metadata: {
        number,
        url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
        title: `Issue ${number}`,
        open: true,
        candidate,
        labels: ['ready-for-agent'],
        assignees: ['rafaeltab', 'zero-two-rafaeltab'],
        projectStatus: candidate ? 'Planned' : null,
        projectPriority: candidate ? 'P1' : null,
        projectSize: candidate ? 'M' : null,
        commentCount: 7,
        parents: [3],
        blockers: [],
        pullRequests: [
          {
            number: 10,
            url: 'https://github.com/rafaeltab/wallpaperdb/pull/10',
            state: 'MERGED' as const,
          },
        ],
      },
    });
    const active = {
      kind: 'job' as const,
      intent: {
        id: 'active',
        issue: 9,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/9',
        base: 'a'.repeat(40),
        context: 'PRIVATE_JOB_SENTINEL',
        branch: 'factory/9',
        createdAt: 0,
        expectedStage: 'implementation' as const,
      },
      execution: { kind: 'absent' as const },
      elapsedMs: 0,
    };
    const parked = {
      ...active,
      intent: { ...active.intent, id: 'parked', issue: 8 },
      delivery: {
        stage: 'implementation' as const,
        active: false,
        ready: false,
        landed: false,
        commit: 'b'.repeat(40),
      },
    };
    const cancelled = {
      ...parked,
      intent: { ...active.intent, id: 'cancelled', issue: 7 },
      delivery: { ...parked.delivery, activity: 'cancelled' as const },
    };
    const input = {
      issues: [makeIssue(1, true), makeIssue(2, true), makeIssue(3, false)],
      job: active,
      jobs: [active, parked, cancelled],
      capacity: { concurrency: 2, admission: 1 },
    };
    await host.save({ planner: { proposal: { selected: [], deferred: [] } } });
    const config = {
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      ...host.mcp,
      stateDirectory: `${host.directory}/planner-state`,
    };
    await Effect.runPromise(t3Planner(config).propose(input));
    const { prompt, requestId } = JSON.parse(
      await readFile(`${host.directory}/planner.json`, 'utf8')
    );
    expect(prompt).toContain(`# Candidate issues\n\n## open 1 - ${input.issues[0]?.title}`);
    expect(prompt).toContain('# Context issues\n\n## open 3 -');
    expect(prompt.match(/^## open 2 -/gm)).toHaveLength(1);
    expect(prompt).toContain('priority: P1\nsize: M');
    expect(prompt).toContain('status: none\npriority: none\nsize: none');
    expect(prompt).toContain('assignees: rafaeltab, zero-two-rafaeltab\nprs: 10 merged');
    expect(prompt).toContain('comment count: 7\nblockers:\n- 2');
    expect(prompt).toContain('blockers: none');
    expect(prompt).toContain('# Running issues\n\n- #9: active\n- #8: parked');
    expect(prompt.match(/^- #9: active$/gm)).toHaveLength(1);
    expect(prompt).not.toContain('- #7:');
    expect(prompt).not.toContain('PRIVATE_JOB_SENTINEL');
    expect(prompt).toContain('fetch its full issue body and all trusted maintainer comments');
    for (const omitted of [
      'PRIVATE_BODY_SENTINEL',
      'PRIVATE_COMMENT_SENTINEL',
      'PRIVATE_EVIDENCE_SENTINEL',
      '"job":',
      '"jobs":',
      'deadline',
      'createdAt',
    ])
      expect(prompt).not.toContain(omitted);
    expect(
      await readFile(`${config.stateDirectory}/planner-message-${requestId}.txt`, 'utf8')
    ).toBe(prompt);
    const record = await (await import('../src/adapters/t3/index.js'))
      .plannerState(config.stateDirectory)
      .read();
    expect((record?.deadline ?? 0) - Date.now()).toBeGreaterThan(590000);
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
