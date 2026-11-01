import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { Job, JobLive, JobStore, Issues, Execution, Time } from '../src/capabilities/job/index.js';
import {
  Scheduler,
  SchedulerLive,
  PlanLive,
  PlanningSource,
  IPlanner,
  ScheduleStore,
  JobPool,
} from '../src/capabilities/plan/index.js';
import { githubIssues } from '../src/adapters/github/index.js';
import { t3Execution } from '../src/adapters/t3/index.js';
import { fileStore, fileScheduleStore } from '../src/adapters/store/index.js';
import { protocol } from './fixtures/setup.js';

it('runs B and C concurrently from ready A with meaningful linear fork comparisons', async () => {
  const host = await protocol();
  const previousPath = process.env.PATH;
  const previousFixture = process.env.FACTORY_FIXTURE;
  process.env.PATH = `${host.directory}:${previousPath}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const workers: ManagedRuntime.ManagedRuntime<Job, never>[] = [];
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', host.repository, ...args], { encoding: 'utf8' }).trim();
  const commit = (message: string) =>
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-am', message);
  try {
    await writeFile(join(host.repository, 'A.txt'), 'Verified prerequisite code');
    git('add', 'A.txt');
    commit('A');
    const a = git('rev-parse', 'HEAD');
    await host.save({
      parallel: true,
      lost: false,
      blockers: [{ number: 573, state: 'open' }],
      prerequisiteHeads: { 591: a },
    });
    const issues = githubIssues({
      project: host.repository,
      base: host.base,
      prerequisites: [{ issue: 573, pr: 591, commit: a }],
    });
    const schedule = fileScheduleStore(join(host.directory, 'schedule'));
    const jobs = new Map<number, Job>();
    for (const number of [574, 575]) {
      const worker = ManagedRuntime.make(
        JobLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(JobStore, fileStore(join(host.directory, `job-${number}`))),
              Layer.succeed(Issues, issues),
              Layer.succeed(Time, { now: () => Effect.succeed(number) }),
              Layer.succeed(
                Execution,
                t3Execution({
                  project: host.repository,
                  projectId: 'project-id',
                  binary: host.binary,
                })
              )
            )
          )
        )
      );
      workers.push(worker);
      jobs.set(number, await worker.runPromise(Job));
    }
    const source: PlanningSource = {
      read: () =>
        Effect.gen(function* () {
          const state = yield* schedule.read();
          return {
            job: { kind: 'empty' as const },
            scheduleRevision: state.revision,
            capacity: { concurrency: 2, admission: 2 },
            issues: [574, 575].map((number) => ({
              number,
              url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
              title: 'Fork',
              body: 'Child of A',
              author: 'rafaeltab',
              open: true,
              labels: ['ready-for-agent'],
              comments: [],
              blockers: [573],
              parents: [],
              blockersReady: true,
              prerequisiteEvidence: `A ${a}`,
            })),
          };
        }),
    };
    const deps = Layer.mergeAll(
      Layer.succeed(Issues, issues),
      Layer.succeed(ScheduleStore, schedule),
      Layer.succeed(JobPool, {
        job: (number) => {
          const job = jobs.get(number);
          if (!job) throw new Error('Unknown demo issue');
          return Effect.succeed(job);
        },
      }),
      Layer.succeed(PlanningSource, source),
      Layer.succeed(IPlanner, {
        propose: () =>
          Effect.succeed({
            selected: [574, 575].map((issue) => ({
              issue,
              reason: 'Independent forks',
              dependsOn: [],
              conflicts: [],
            })),
            deferred: [],
          }),
      })
    );
    const runtime = ManagedRuntime.make(
      SchedulerLive.pipe(
        Layer.provideMerge(PlanLive.pipe(Layer.provide(deps))),
        Layer.provide(deps)
      )
    );
    try {
      const scheduler = await runtime.runPromise(Scheduler);
      await runtime.runPromise(
        scheduler.configure({ revision: -1, concurrency: 2, allowance: 2, paused: false })
      );
      const status = await runtime.runPromise(scheduler.tick(host.base));
      expect(status.jobs).toHaveLength(2);
      const comparisons = [];
      for (const job of status.jobs) {
        if (job.kind !== 'job' || job.execution.kind !== 'found')
          throw new Error('Missing bound worker');
        expect(job.execution.status).toBe('running');
        expect(job.intent.base).toBe(a);
        expect(job.intent.prBase).toBe('factory/pr-591');
        expect(await readFile(join(job.execution.worktree, 'A.txt'), 'utf8')).toBe(
          'Verified prerequisite code'
        );
        await writeFile(join(job.execution.worktree, `${job.intent.issue}.txt`), 'Child code');
        git('-C', job.execution.worktree, 'add', '.');
        git(
          '-C',
          job.execution.worktree,
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-m',
          `Child ${job.intent.issue}`
        );
        expect(git('diff', '--name-only', `${a}...${job.intent.branch}`)).toBe(
          `${job.intent.issue}.txt`
        );
        expect(git('rev-list', '--merges', `${host.base}..${job.intent.branch}`)).toBe('');
        comparisons.push({
          issue: job.intent.issue,
          base: a,
          target: job.intent.prBase,
          head: git('rev-parse', job.intent.branch),
          files: git('diff', '--name-only', `${a}...${job.intent.branch}`),
        });
      }
      console.log(
        JSON.stringify({
          provenance:
            'Production scheduler, jobs, storage and GitHub/T3 adapters; isolated real Git/worktrees; controlled external protocols and deterministic planner. A acceptance/review is an operator assertion, not a live model publication.',
          comparisons,
        })
      );
    } finally {
      await runtime.dispose();
    }
  } finally {
    await Promise.all(workers.map((worker) => worker.dispose()));
    process.env.PATH = previousPath;
    if (previousFixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previousFixture;
    await host.cleanup();
  }
});
