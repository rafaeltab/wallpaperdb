#!/usr/bin/env node
import nodeProcess from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  appendFileSync,
  readdirSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';

class ProtocolExit {
  declare code: number;
  constructor(code: number) {
    this.code = code;
  }
}

// Reuse the same controlled protocol over the CLI and the existing adapter transport seam.
/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {string[]} argv
 * @param {Pick<Console, 'log' | 'error'>} output
 * @param {AbortSignal} [signal]
 */
export async function runProtocol(
  environment: NodeJS.ProcessEnv,
  argv: string[],
  output: Pick<Console, 'log' | 'error'>,
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  const process = {
    env: environment,
    argv,
    pid: nodeProcess.pid,
    stderr: { write: (text: string) => output.error(text) },
    exit: (code: number): never => {
      throw new ProtocolExit(code);
    },
  };
  const console = output;
  try {
    const config = JSON.parse(readFileSync(process.env.FACTORY_FIXTURE!, 'utf8'));
    const args = process.argv.slice(2);
    // Manual-operation fixtures still serve the background observation queries.
    // Reuse the project protocol without inventing discoverable admissions.
    const observationQuery =
      !config.planning &&
      basename(process.argv[1]) === 'gh' &&
      args[0] === 'api' &&
      args[1] === 'graphql' &&
      (args.join(' ').includes('projectV2(number:7)') ||
        /[ip]\d+:(?:issue|pullRequest)\(number:/.test(args.join(' ')));
    if (observationQuery)
      config.planning = {
        issues: [...args.join(' ').matchAll(/i\d+:issue\(number:(\d+)\)/g)].map((match) => ({
          number: Number(match[1]),
          url: `https://github.com/rafaeltab/wallpaperdb/issues/${match[1]}`,
          title: config.issueTitle ?? 'Controlled issue',
          updatedAt: '2026-11-13T00:00:00Z',
          body: config.body ?? '',
          state: config.issueStates?.[match[1]] ?? 'OPEN',
          author: { login: 'rafaeltab' },
          labels: [],
          comments: [],
        })),
      };
    const stageHeld = (resource: { stage?: string; status?: string } | null) =>
      !['failed', 'interrupted', 'cancelled'].includes(
        config.overrides?.status ?? resource?.status
      ) &&
      ((resource?.stage === 'implementation' && config.holdImplementation) ||
        (resource?.stage === 'review' && config.holdReview) ||
        (resource?.stage === 'publication' && config.holdPublication));
    const hold = async (boundary: string) => {
      const separate = config.holds?.includes(boundary);
      if (!separate && config.hold !== boundary) return;
      writeFileSync(join(config.directory, separate ? `held-${boundary}` : 'held'), boundary);
      writeFileSync(join(config.directory, `held-${boundary}.pid`), String(process.pid));
      const { setTimeout } = await import('node:timers/promises');
      const deadline = Date.now() + 20000;
      while (!existsSync(join(config.directory, separate ? `release-${boundary}` : 'release'))) {
        if (Date.now() > deadline) throw new Error('Controlled protocol hold expired');
        await setTimeout(20, undefined, { signal });
      }
      writeFileSync(join(config.directory, 'released'), boundary);
    };
    if (!environment.FACTORY_WS_FIXTURE)
      appendFileSync(
        join(config.directory, 'calls.jsonl'),
        `${JSON.stringify({ binary: basename(process.argv[1]), args })}\n`
      );
    if (args[0] === 'auth' && args[1] === 'session') {
      if (args[2] === 'issue')
        console.log(
          JSON.stringify({
            sessionId: 'controlled-observer-session',
            token: 'controlled-observer',
            scopes: ['orchestration:read'],
            method: 'bearer-access-token',
            expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          })
        );
      process.exit(0);
    }
    if (args[0] === 'acp-mcp-call' && args[1] === 't3_thread_configure') {
      const { threadId } = JSON.parse(args[2]);
      const resource =
        threadId === 'planner-thread'
          ? JSON.parse(readFileSync(join(config.directory, 'planner.json'), 'utf8'))
          : JSON.parse(
              readFileSync(
                join(
                  config.directory,
                  config.parallel
                    ? `resource-${threadId.replaceAll('/', '-')}.json`
                    : 'resource.json'
                ),
                'utf8'
              )
            );
      console.log(
        JSON.stringify({
          structuredContent: {
            threadId,
            modelSelection: {
              instanceId: 'codex',
              model: resource.model,
              options: resource.options ?? [],
            },
            runtimeMode: resource.runtimeMode ?? 'full-access',
          },
        })
      );
      process.exit(0);
    }
    if (args[0] === 'acp-mcp-call' && args[1] === 'orchestrator_capabilities') {
      console.log(
        JSON.stringify({
          structuredContent: (JSON.parse(args[2]).search
            ? config.executionSearchCatalog
            : undefined) ??
            config.executionCatalog ?? {
              runtimeMode: 'full-access',
              providers: [
                {
                  providerInstanceId: 'codex',
                  constraints: [],
                  models: [
                    {
                      id: 'gpt-6.1-sol',
                      options: [
                        { id: 'reasoningEffort', values: ['low', 'high'] },
                        { id: 'serviceTier', values: ['default', 'priority'] },
                      ],
                    },
                    {
                      id: 'gpt-6.2-sol',
                      options: [
                        { id: 'reasoningEffort', values: ['low', 'high'] },
                        { id: 'serviceTier', values: ['default', 'priority'] },
                      ],
                    },
                  ],
                },
              ],
            },
        })
      );
      process.exit(0);
    }
    if (args[0] === 'acp-mcp-call' && args[1] === 't3_thread_launch') {
      const input = JSON.parse(args[2]);
      const options = input.modelSelection.options ?? [];
      const code = await runProtocol(
        environment,
        [
          argv[0],
          argv[1],
          'thread',
          'start',
          input.projectId,
          input.message,
          '--title',
          input.title,
          '--provider',
          input.modelSelection.instanceId,
          '--model',
          input.modelSelection.model,
          ...(input.workspaceStrategy
            ? [
                '--worktree',
                input.workspaceStrategy.baseRef,
                '--branch',
                input.workspaceStrategy.branch,
              ]
            : []),
          '--execution-options',
          JSON.stringify(options),
          '--permission-level',
          input.runtimeMode ?? '',
          '--json',
        ],
        {
          log: (value) => console.log(JSON.stringify({ structuredContent: JSON.parse(value) })),
          error: (value) => console.error(value),
        },
        signal
      );
      process.exit(code);
    }
    if (
      basename(process.argv[1]) === 'gh' &&
      args[0] === 'api' &&
      args[1] === 'graphql' &&
      args.join(' ').includes('projectV2(number:7)')
    )
      await hold('github-observation');
    if (basename(process.argv[1]) === 'gh' && process.env.GH_DEBUG === 'api') {
      appendFileSync(
        join(config.directory, 'github-requests.jsonl'),
        JSON.stringify({ at: Date.now(), args }) + '\n'
      );
      const rate = config.githubRate ?? {};
      const resource = args[0] === 'api' && args[1] !== 'graphql' ? 'core' : 'graphql';
      const status = rate.status ?? 200;
      process.stderr.write(
        `< HTTP/2.0 ${status} Fixture\n` +
          `< X-Ratelimit-Resource: ${resource}\n` +
          `< X-Ratelimit-Limit: ${rate.limit ?? 1000000}\n` +
          `< X-Ratelimit-Remaining: ${rate.remaining ?? 999999}\n` +
          `< X-Ratelimit-Reset: ${rate.reset ?? config.githubQuotaReset}\n` +
          (rate.retryAfter ? `< Retry-After: ${rate.retryAfter}\n` : '') +
          '<\n'
      );
      if (status !== 200) {
        console.log(JSON.stringify({ message: 'Controlled provider throttling' }));
        process.exit(1);
      }
      if (rate.limited && resource === 'graphql') {
        process.stderr.write(
          '{"errors":[{"type":"RATE_LIMITED","message":"Secondary rate limit"}]}\n'
        );
        process.exit(1);
      }
      if (args[0] === 'api' && args[1] === 'rate_limit') {
        await hold('github-bootstrap');
        console.log(
          JSON.stringify({
            resources: Object.fromEntries(
              [
                ...['core', 'graphql', 'search'],
                ...(rate.unavailableResource ? ['code_search'] : []),
              ].map((name) => [
                name,
                {
                  limit: name === 'code_search' ? 0 : (rate.limit ?? 1000000),
                  remaining: name === 'code_search' ? 0 : (rate.remaining ?? 999999),
                  reset: rate.reset ?? config.githubQuotaReset,
                },
              ])
            ),
          })
        );
        process.exit(0);
      }
      const log = console.log;
      console.log = (...values) => {
        if (
          args[0] === 'api' &&
          args[1] === 'graphql' &&
          args.some((a) => a.includes('factoryRateLimit:'))
        ) {
          const value = JSON.parse(values[0]);
          for (const page of Array.isArray(value) ? value : [value])
            if (page?.data)
              page.data.factoryRateLimit = {
                cost: rate.cost ?? 1,
                limit: rate.limit ?? 1000000,
                remaining: rate.remaining ?? 999999,
                resetAt: new Date((rate.reset ?? config.githubQuotaReset) * 1000).toISOString(),
              };
          values[0] = JSON.stringify(value);
        }
        log(...values);
      };
    }
    if (args[0] === 'acp-mcp-call' && args[1] === 't3_environment_read') {
      console.log(
        JSON.stringify(
          config.metadataUnavailable
            ? { isError: true }
            : { structuredContent: { environmentId: 'controlled-environment' } }
        )
      );
      process.exit(0);
    }
    if (args[0] === 'acp-mcp-call' && args[1] === 't3_thread_list') {
      const resources = readdirSync(config.directory)
        .filter((name) => /^resource(?:-.*)?\.json$/.test(name))
        .map((name) => ({
          ...JSON.parse(readFileSync(join(config.directory, name), 'utf8')),
          parentThreadId: null,
        }));
      console.log(
        JSON.stringify({
          structuredContent: {
            threads: [
              ...resources,
              ...readdirSync(config.directory)
                .filter((name) => /^restacker.*\.json$/.test(name))
                .map((name) => ({
                  threadId: JSON.parse(readFileSync(join(config.directory, name), 'utf8')).thread
                    .threadId,
                  parentThreadId: null,
                })),
              ...(config.descendants ?? []),
            ],
            nextCursor: config.lineageTruncated ? 1 : null,
          },
        })
      );
      process.exit(0);
    }
    if (args[0] === 'acp-mcp-call' && args[1] === 't3_thread_organize') {
      const input = JSON.parse(args[2]);
      if (input.action !== 'settle' || input.threadId !== 'planner-thread')
        throw new Error('Unexpected planner cleanup');
      if (config.planner?.settleFails) throw new Error('Controlled settlement failure');
      if (config.planner?.settleDelayMs) {
        const { setTimeout } = await import('node:timers/promises');
        await setTimeout(config.planner.settleDelayMs, undefined, { signal });
      }
      if (!config.planner?.settleUnconfirmed)
        writeFileSync(join(config.directory, 'planner-settled'), 'true');
      console.log(JSON.stringify({ structuredContent: { sequence: 1 } }));
      process.exit(0);
    }
    if (
      args[0] === 'acp-mcp-call' &&
      args[1] === 't3_thread_interrupt' &&
      JSON.parse(args[2]).threadId === 'planner-thread'
    ) {
      if (config.planner?.interruptFails)
        throw new Error('Controlled planner interruption failure');
      if (config.planner?.interruptCompletes)
        writeFileSync(join(config.directory, 'planner-interrupted'), 'true');
      console.log(
        JSON.stringify({
          structuredContent: { status: 'interrupt_requested', threadId: 'planner-thread' },
        })
      );
      process.exit(0);
    }
    const earlyFlag = (name: string) => args[args.indexOf(name) + 1];
    if (
      basename(process.argv[1]) === 'gh' &&
      args[0] === 'api' &&
      args[1] === 'graphql' &&
      earlyFlag('-f')?.includes('closedByPullRequestsReferences') &&
      !earlyFlag('-f')?.includes('includeClosedPrs:true')
    ) {
      const number = Number(earlyFlag('-f').match(/issue\(number:(\d+)\)/)![1]);
      console.log(
        JSON.stringify({
          data: {
            repository: {
              nameWithOwner: 'rafaeltab/wallpaperdb',
              defaultBranchRef: {
                name: config.defaultBranch?.name ?? 'main',
                target: { oid: config.defaultBranch?.tip },
              },
              issue: {
                number,
                state: config.issueStates?.[number] ?? 'OPEN',
                closedByPullRequestsReferences: {
                  nodes: (config.landedPrerequisites?.[number] ?? []).map((pr: number) => ({
                    number: pr,
                    url: `https://github.com/rafaeltab/wallpaperdb/pull/${pr}`,
                  })),
                  pageInfo: { hasNextPage: config.landingTruncated ?? false },
                },
              },
            },
          },
        })
      );
      process.exit(0);
    }
    if (
      basename(process.argv[1]) === 'gh' &&
      args[0] === 'api' &&
      /^repos\/rafaeltab\/wallpaperdb\/pulls\/\d+$/.test(args[1]) &&
      Object.hasOwn(config.mergedPrerequisites ?? {}, args[1].split('/').at(-1)!)
    ) {
      console.log(JSON.stringify(config.mergedPrerequisites?.[args[1].split('/').at(-1)!] ?? null));
      process.exit(0);
    }
    if (
      (config.restack || config.automaticReviews) &&
      basename(process.argv[1]) === 't3' &&
      !args.includes('--help') &&
      (args[1] === 'list' ||
        (args[1] === 'start' && args[3]?.includes('Operation ')) ||
        args[2]?.startsWith('restacker') ||
        (args[0] === 'acp-mcp-call' &&
          args[2] &&
          JSON.parse(args[2]).threadId?.startsWith('restacker')))
    ) {
      config.restack ??= { outcome: 'SIMPLE', review: true };
      const records = readdirSync(config.directory)
        .filter((name) => /^restacker.*\.json$/.test(name))
        .map((name) => ({
          name,
          state: JSON.parse(readFileSync(join(config.directory, name), 'utf8')),
        }));
      const selected = records.find(
        ({ state }) =>
          state.thread.threadId ===
          (args[0] === 'acp-mcp-call' ? JSON.parse(args[2]).threadId : args[2])
      );
      const automatic =
        (args[1] === 'start' && args[3]?.includes('Automatic replay review.')) ||
        selected?.state.automatic === true;
      if (automatic)
        config.restack = { outcome: 'SIMPLE', review: config.automaticReview !== false };
      const path = join(
        config.directory,
        automatic && args[1] === 'start'
          ? `restacker-${args[3].match(/Operation ([a-f0-9]+)\./)![1]}.json`
          : (selected?.name ?? 'restacker.json')
      );
      const flag = (name: string) => args[args.indexOf(name) + 1];
      let state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
      const git = (cwd: string, ...values: string[]) =>
        execFileSync('git', values, {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
      if (
        args[0] === 'acp-mcp-call' &&
        args[1] === 't3_thread_read' &&
        JSON.parse(args[2]).view === 'activity'
      ) {
        console.log(
          JSON.stringify({
            structuredContent: {
              thread: {
                ...state.thread,
                activeRunId: null,
                pendingBackgroundTasks: [],
                blockedOnThreadWait: false,
                pullRequests: [],
              },
              items:
                config.restack.question && state.thread.pendingRequestCount > 0
                  ? [
                      {
                        itemId: 'restack-question',
                        type: 'user_input_request',
                        runId: state.thread.latestRunId,
                        status: 'waiting',
                        text: config.restack.question,
                        sourceThreadId: state.thread.threadId,
                        visibility: 'local',
                      },
                    ]
                  : [],
              hasMore: false,
              nextPosition: null,
            },
          })
        );
      } else if (args[0] === 'acp-mcp-call') {
        console.log(
          JSON.stringify({
            structuredContent: {
              thread: { latestRunId: state.thread.latestRunId },
              items: config.restack.question
                ? [
                    {
                      itemId: 'restack-question',
                      runId: state.thread.latestRunId,
                      type: 'user_input_request',
                      status: 'waiting',
                      text: config.restack.question,
                      sourceThreadId: 'restacker',
                      visibility: 'local',
                    },
                  ]
                : [],
              hasMore: false,
              nextPosition: null,
            },
          })
        );
      } else if (args[1] === 'start') {
        const prompt = args[3];
        const operation = prompt.match(/Operation ([a-f0-9]+)\./)![1];
        const implemented = prompt.match(/issues\/(\d+)/)![1];
        const [onto, parent] = prompt.match(/git rebase --onto ([a-f0-9]+) ([a-f0-9]+)/)!.slice(1);
        const worktree = join(config.directory, `recovery-worker-${operation}`);
        git(
          config.repository,
          'worktree',
          'add',
          '-b',
          flag('--branch'),
          worktree,
          flag('--worktree')
        );
        try {
          git(worktree, 'rebase', '--onto', onto, parent);
        } catch {
          writeFileSync(
            join(worktree, 'shared.txt'),
            config.restack.outcome === 'COMPLEX'
              ? `export const behavior = () => 'resolved D and C behavior${state?.operation && state.operation !== operation ? ` ${operation}` : ''}';`
              : `resolved D and C behavior${state?.operation && state.operation !== operation ? ` ${operation}` : ''}`
          );
          git(worktree, 'add', 'shared.txt');
          execFileSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], {
            cwd: worktree,
            stdio: 'pipe',
          });
        }
        const head = git(worktree, 'rev-parse', 'HEAD');
        const conflictCount = records.filter(({ state }) => !state.automatic).length;
        if (!automatic && state?.operation && state.operation !== operation)
          writeFileSync(
            join(config.directory, `restacker-${state.operation}.json`),
            JSON.stringify(state)
          );
        const requestedThreadId =
          automatic || conflictCount > 0 ? `restacker-${operation}` : 'restacker';
        state = {
          automatic,
          requestedThreadId,
          thread: {
            threadId: config.restack.responseThreadId ?? requestedThreadId,
            projectId: 'project-id',
            title: flag('--title'),
            branch: flag('--branch'),
            providerInstanceId: 'codex',
            model: flag('--model') || 'gpt-6.1-sol',
            options: args.includes('--execution-options')
              ? JSON.parse(flag('--execution-options'))
              : [],
            runtimeMode: args.includes('--permission-level')
              ? flag('--permission-level') || 'full-access'
              : 'full-access',
            worktreePath: worktree,
            status: config.restack.question ? 'waiting' : (config.recoveryStatus ?? 'completed'),
            pendingRequestCount: config.restack.question ? 1 : 0,
            latestRunId: 'resolve-run',
            runCount: config.restack.resolveOrdinal ?? 1,
          },
          operation,
          onto,
          implemented,
          head,
          messages: [
            { role: 'user', text: `Factory instruction ${operation}:resolve.` },
            {
              role: 'assistant',
              text:
                config.restack.outcome && !config.omitRecoveryClassification
                  ? `<RESTACK>${config.restack.outcome}</RESTACK>`
                  : 'unknown',
            },
            {
              role: 'assistant',
              runId: config.restack.staleRun ? 'prior-run' : 'resolve-run',
              text:
                config.restack.question ??
                JSON.stringify(
                  config.legacyRecoveryInitial
                    ? { operation, commit: head, outcome: '<RESTACK>SIMPLE</RESTACK>' }
                    : {
                        version: 1,
                        kind: 'state',
                        jobId:
                          config.restack.stale || config.restack.wrongDelivery
                            ? 'stale'
                            : operation,
                        implemented: prompt.match(/issues\/(\d+)/)![1],
                        base: config.restack.wrongBase ? config.base : onto,
                        checked: config.recoveryChecked ?? head,
                        reviewed: automatic && config.restack.review ? head : undefined,
                        checks: {
                          format: true,
                          lint: true,
                          tests: true,
                          coverage: true,
                          crap: true,
                        },
                      }
                ),
            },
          ],
        };
        writeFileSync(path, JSON.stringify(state));
        await hold('restack');
        if (config.restack.loseLaunch) process.exit(1);
        console.log(
          JSON.stringify({
            threadId: state.thread.threadId,
            projectId: 'project-id',
            runId: 'resolve-run',
          })
        );
      } else if (args[1] === 'send') {
        if (args[3].includes('Restack reconciliation ')) {
          if (config.dropRecoverySend) throw new Error('Controlled undelivered recovery send');
          state.thread.runCount += 1;
          state.thread.latestRunId = `reconciliation-${state.thread.runCount}`;
          state.thread.status = config.cancelRecoveryOnSend ? 'cancelled' : 'completed';
          const phase = args[3].match(/Factory instruction [^:]+:(resolve|review)\./)![1];
          const head = git(state.thread.worktreePath, 'rev-parse', 'HEAD');
          state.messages.push(
            { role: 'user', text: args[3] },
            { role: 'assistant', text: `<RESTACK>${config.restack.outcome ?? 'SIMPLE'}</RESTACK>` },
            {
              role: 'assistant',
              text: JSON.stringify(
                config.legacyRecoveryReply
                  ? {
                      operation: state.operation,
                      commit: head,
                      outcome: '<RESTACK>SIMPLE</RESTACK>',
                    }
                  : {
                      version: 1,
                      kind: 'state',
                      jobId:
                        config.restack.stale || config.restack.wrongDelivery
                          ? 'stale'
                          : state.operation,
                      implemented: state.implemented,
                      base: config.restack.wrongBase ? config.base : state.onto,
                      checked: head,
                      reviewed: (
                        state.automatic
                          ? config.reconcileReview
                          : phase === 'review' && config.restack.review
                      )
                        ? head
                        : undefined,
                      checks: { format: true, lint: true, tests: true, coverage: true, crap: true },
                    }
              ),
            }
          );
          writeFileSync(path, JSON.stringify(state));
          await hold('recovery-send');
          if (config.loseRecoverySend) throw new Error('Controlled lost recovery response');
          console.log('{}');
          process.exit(0);
        }
        if (config.dropInitialReviewSend) throw new Error('Controlled undelivered initial review');
        const { DatabaseSync } = await import('node:sqlite');
        const shared = existsSync(join(config.directory, 'factory.sqlite'));
        const database = new DatabaseSync(
          join(config.directory, ...(shared ? [] : ['joins']), 'factory.sqlite'),
          { readOnly: true }
        );
        try {
          const snapshots = database
            .prepare('SELECT value FROM records WHERE name = ? AND namespace LIKE ?')
            .all('recovery-progress.json', shared ? 'joins/%' : '%')
            .map((record) => JSON.parse(record.value as string));
          writeFileSync(
            join(config.directory, 'review-capacity-observed.json'),
            JSON.stringify(snapshots)
          );
        } finally {
          database.close();
        }
        if (config.restack.repair) {
          writeFileSync(
            join(state.thread.worktreePath, 'shared.txt'),
            'resolved D and C after independent review'
          );
          git(state.thread.worktreePath, 'add', 'shared.txt');
          git(state.thread.worktreePath, 'commit', '-m', 'Repair C conflict after review');
          state.head = git(state.thread.worktreePath, 'rev-parse', 'HEAD');
        }
        state.thread.runCount = config.restack.reviewOrdinal ?? state.thread.runCount + 1;
        state.thread.latestRunId = 'review-run';
        state.messages = [
          { role: 'user', text: `Factory instruction ${state.operation}:review.` },
          {
            role: 'assistant',
            runId: 'review-run',
            text: JSON.stringify(
              config.legacyReviewReply
                ? {
                    operation: state.operation,
                    commit: state.head,
                    outcome: '<REVIEW>COMPLETE</REVIEW>',
                  }
                : {
                    version: 1,
                    kind: 'state',
                    jobId: state.operation,
                    implemented: state.implemented,
                    base: state.onto,
                    checked: git(state.thread.worktreePath, 'rev-parse', 'HEAD'),
                    reviewed: config.restack.review
                      ? git(state.thread.worktreePath, 'rev-parse', 'HEAD')
                      : undefined,
                    checks: { format: true, lint: true, tests: true, coverage: true, crap: true },
                  }
            ),
          },
        ];
        writeFileSync(path, JSON.stringify(state));
        if (config.loseInitialReviewSend)
          throw new Error('Controlled lost initial review response');
        console.log('{}');
      } else if (args[1] === 'list')
        console.log(
          JSON.stringify([
            ...(config.joinWriter ? [{ threadId: 'writer-C', title: 'Controlled writer' }] : []),
            ...readdirSync(config.directory)
              .filter((name) => /^resource.*\.json$/.test(name))
              .map((name) => JSON.parse(readFileSync(join(config.directory, name), 'utf8'))),
            ...records.flatMap(({ state }) =>
              Array.from({ length: config.duplicate ? 2 : 1 }, () => ({
                threadId: state.requestedThreadId ?? state.thread.threadId,
                title: state.thread.title,
              }))
            ),
          ])
        );
      else console.log(JSON.stringify(state));
      process.exit(0);
    }
    if (
      basename(process.argv[1]) === 'gh' &&
      args[0] === 'api' &&
      args[1] === 'repos/rafaeltab/wallpaperdb' &&
      !config.landing
    ) {
      console.log(JSON.stringify({ default_branch: config.defaultBranch?.name ?? 'main' }));
      process.exit(0);
    }
    if (
      basename(process.argv[1]) === 'gh' &&
      args[0] === 'api' &&
      args[1].includes('/pulls/') &&
      (!config.landing ||
        (Number(args[1].split('/').at(-1)!) !== config.landing.pr &&
          !Object.hasOwn(config.landing.merges ?? {}, args[1].split('/').at(-1)!)))
    ) {
      console.log(
        JSON.stringify({
          merged: false,
          merge_commit_sha: null,
          head: { sha: 'a'.repeat(40) },
          base: { ref: 'main' },
        })
      );
      process.exit(0);
    }
    if (
      config.landing &&
      basename(process.argv[1]) === 'gh' &&
      args[0] === 'api' &&
      (args[1] === 'repos/rafaeltab/wallpaperdb' ||
        args[1].includes('/compare/') ||
        (args[1].includes('/pulls/') &&
          (Number(args[1].split('/').at(-1)!) === config.landing.pr ||
            Object.hasOwn(config.landing.merges ?? {}, args[1].split('/').at(-1)!))))
    ) {
      const value = config.landing.merges?.[args[1].split('/').at(-1)!] ?? config.landing;
      if (args[1].includes('/compare/'))
        console.log(
          JSON.stringify({
            status: value.reachable === false ? 'diverged' : 'ahead',
            merge_base_commit: { sha: args[1].split('/compare/')[1].split('...')[0] },
          })
        );
      else if (args[1].includes('/pulls/'))
        console.log(
          JSON.stringify({
            merged: true,
            merge_commit_sha: value.merge,
            head: { sha: value.head },
            base: { ref: value.base ?? 'main' },
          })
        );
      else console.log(JSON.stringify({ default_branch: config.defaultBranch?.name ?? 'main' }));
      process.exit(0);
    }
    if (
      config.landing &&
      basename(process.argv[1]) === 'gh' &&
      args[0] === 'issue' &&
      args.includes('state,projectItems')
    ) {
      console.log(
        JSON.stringify({
          state: config.landing.issueState ?? 'CLOSED',
          projectItems: [
            { title: 'WallpaperDB', status: { name: config.landing.status ?? 'Done' } },
          ],
        })
      );
      process.exit(0);
    }
    if (config.joinWriter && basename(process.argv[1]) === 't3') {
      console.log(
        JSON.stringify(
          args[1] === 'list'
            ? [{ threadId: 'writer-C' }]
            : {
                thread: {
                  projectId: 'project-id',
                  branch: config.joinWriterBranch ?? 'C',
                  status: config.joinWriter === 'completed' ? 'completed' : 'running',
                  pendingRequestCount: 0,
                },
              }
        )
      );
      process.exit(0);
    }
    if (
      basename(process.argv[1]) === 'gh' &&
      args[0] === 'api' &&
      args[1] === 'repos/rafaeltab/wallpaperdb/git/ref/heads/main'
    ) {
      const sha = execFileSync(
        'git',
        ['-C', config.repository, 'ls-remote', '--heads', 'origin', 'refs/heads/main'],
        { encoding: 'utf8' }
      )
        .trim()
        .split(/\s/)[0];
      console.log(JSON.stringify({ object: { sha: config.authenticatedMain ?? sha } }));
      process.exit(0);
    }
    if (config.join && basename(process.argv[1]) === 'gh' && !observationQuery) {
      const statePath = join(config.directory, 'join-live.json');
      const state = existsSync(statePath)
        ? JSON.parse(readFileSync(statePath, 'utf8'))
        : config.join;
      const number =
        args[0] === 'pr' && args[1] === 'list'
          ? Number(
              Object.entries(state.prs).find(
                ([, value]) =>
                  (value as { branch: string }).branch === args[args.indexOf('--head') + 1]
              )?.[0]
            )
          : Number(args[2]);
      const flag = (name: string) => args[args.indexOf(name) + 1];
      const git = (...values: string[]) =>
        execFileSync('git', ['-C', config.repository, ...values], { encoding: 'utf8' }).trim();
      let result = {};
      if (args[0] === 'issue' && args[1] === 'view')
        result = {
          number,
          state:
            config.issueStates?.[number] ??
            (state.closedIssues?.includes(number) ? 'CLOSED' : 'OPEN'),
          author:
            state.issueAuthors?.[number] === undefined
              ? { login: 'rafaeltab' }
              : state.issueAuthors[number],
          url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
          labels: [{ name: 'ready-for-agent' }],
          body: state.evidence + (state.issueBodyContext?.[number] ?? ''),
          comments: state.issueComments?.[number] ?? [],
        };
      else if (args[0] === 'issue' && args[1] === 'comment')
        state.evidence += `\n${flag('--body')}`;
      else if (args[0] === 'api' && args[1] === 'graphql')
        result = { data: { repository: { issue: { parent: { number: 571 } } } } };
      else if (args[0] === 'api' && args[1].includes('dependencies'))
        result = [
          state.blockers ?? [
            { number: 3, state: 'open' },
            { number: 4, state: 'open' },
          ],
        ];
      else if (args[0] === 'pr' && ['view', 'list'].includes(args[1])) {
        const item = state.prs[String(number)];
        const head =
          item.head ??
          git('ls-remote', '--heads', 'origin', `refs/heads/${item.branch}`).split(/\s/)[0];
        result = {
          url: `https://github.com/rafaeltab/wallpaperdb/pull/${number}`,
          closingIssuesReferences: config.missingClosingLink
            ? []
            : [{ url: `https://github.com/rafaeltab/wallpaperdb/issues/${number - 100}` }],
          headRefOid: head,
          headRefName: item.branch,
          baseRefName: item.base,
          baseRefOid: git('rev-parse', item.base),
          author: item.author === undefined ? { login: 'rafaeltab' } : item.author,
          body: item.body ?? '',
          comments: item.comments ?? [],
          state: item.state ?? 'OPEN',
          isDraft: false,
          mergeable: 'MERGEABLE',
          statusCheckRollup: ['Build, Lint, and Test', 'E2E Tests', 'Container E2E Tests'].map(
            (name: string) => ({
              name,
              status: 'COMPLETED',
              conclusion:
                head === state.originalHeads?.[String(number)]
                  ? 'SUCCESS'
                  : (state.newCI ?? 'SUCCESS'),
            })
          ),
        };
        if (args[1] === 'list') result = [result];
      } else if (args[0] === 'pr' && args[1] === 'edit')
        state.prs[String(number)].base = flag('--base');
      else if (
        args[0] === 'api' &&
        args.includes('POST') &&
        args.includes('repos/rafaeltab/wallpaperdb/stacks')
      ) {
        state.members = state.corruptGrouping
          ? []
          : args
              .filter((value) => value.startsWith('pull_requests[]='))
              .map(
                (value) => `https://github.com/rafaeltab/wallpaperdb/pull/${value.split('=')[1]}`
              );
        state.groups = state.members.length
          ? [
              {
                number: 900,
                pull_requests: state.members.map((url: string) => ({
                  number: Number(url.split('/').at(-1)),
                })),
              },
            ]
          : [];
      } else if (args[0] === 'api' && args.includes('POST')) {
        const path = args.find((value) => value.includes('/unstack'));
        const number = Number(path!.split('/').at(-2));
        if (state.groups)
          state.groups = state.groups.filter(
            (group: { number: number; pull_requests: { number: number }[] }) =>
              group.number !== number
          );
        else state.members = [];
      } else if (args[0] === 'api' && args[1].includes('/stacks')) {
        const groups =
          state.groups ??
          (state.members.length
            ? [
                {
                  number: 9,
                  pull_requests: state.members.map((url: string) => ({
                    number: Number(url.split('/').at(-1)),
                  })),
                },
              ]
            : []);
        const requested = Number(args[1].match(/pull_request=(\d+)/)?.[1]);
        result = groups.filter((group: { number: number; pull_requests: { number: number }[] }) =>
          group.pull_requests.some((pr: { number: number }) => pr.number === requested)
        );
      }
      const boundary =
        args.includes('repos/rafaeltab/wallpaperdb/stacks') && args.includes('POST')
          ? 'group'
          : args[0] === 'pr' && args[1] === 'edit'
            ? 'base'
            : args[0] === 'issue' && args[1] === 'comment'
              ? 'evidence'
              : null;
      const save = () => {
        const next = `${statePath}.${process.pid}.next`;
        writeFileSync(next, JSON.stringify(state));
        renameSync(next, statePath);
      };
      if (state.lose === boundary && boundary) {
        state.lose = null;
        save();
        process.exit(1);
      }
      // Queries can overlap each other and metadata edits. They must not publish
      // their old snapshots over a completed edit or expose a truncated JSON file.
      if (boundary || (args[0] === 'api' && args.includes('POST'))) save();
      await hold(boundary!);
      console.log(JSON.stringify(result));
      process.exit(0);
    }
    const mcpSend = args[0] === 'acp-mcp-call' && args[1] === 't3_thread_send';
    if (mcpSend) {
      const input = JSON.parse(args[2]);
      args.splice(0, args.length, 'thread', 'send', input.threadId, input.message);
    }
    const flag = (name: string) => args[args.indexOf(name) + 1];
    const reply = (value: unknown) => console.log(JSON.stringify(value));
    if (config.planning && basename(process.argv[1]) === 'gh' && args[0] !== 'pr') {
      if (args[1] === 'list') {
        await hold('planning-read');
        await hold(
          existsSync(join(config.directory, 'planner.json'))
            ? 'planning-freshness'
            : 'planning-discovery'
        );
        reply(
          (
            config.planning.candidates ??
            config.planning.issues.map((i: { number: number }) => i.number)
          ).map((number: number) => ({
            number,
          }))
        );
      } else if (args[0] === 'api' && args[1] === 'graphql') {
        const query = args.join(' ');
        const projectIssue = (n: number) => {
          const item =
            config.planning.issues.find((i: { number: number }) => i.number === n) ??
            config.planning.context;
          if (!item) return null;
          const conn = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false } });
          return {
            ...item,
            parent:
              config.planning.foreignParent ??
              (config.planning.parent
                ? {
                    number: config.planning.parent,
                    url: `https://github.com/rafaeltab/wallpaperdb/issues/${config.planning.parent}`,
                  }
                : (item.parent ?? null)),
            labels: conn(item.labels),
            assignees: conn([]),
            comments: { totalCount: item.comments.length },
            projectItems: {
              ...conn(config.planning.projectItems ?? []),
              pageInfo: { hasNextPage: config.planning.incompleteMetadata ?? false },
            },
            blockedBy: conn(
              (config.planning.blockers ?? []).map((b: { number: number; html_url?: string }) => ({
                number: b.number,
                url: b.html_url ?? `https://github.com/rafaeltab/wallpaperdb/issues/${b.number}`,
              }))
            ),
            closedByPullRequestsReferences: conn(config.planning.nativePulls?.[n] ?? []),
            timelineItems: conn([]),
          };
        };
        const allPulls = [
          ...(config.planning.openPulls ?? []),
          ...Object.values(config.planning.nativePulls ?? {}).flat(),
          ...(config.planning.openPullPages ?? []).flatMap(
            (p: { data: { repository: { pullRequests: { nodes: unknown[] } } } }) =>
              p.data.repository.pullRequests.nodes
          ),
        ];
        if (query.includes('projectV2(number:7)')) {
          if (config.planning.projectPages) {
            reply(config.planning.projectPages);
            return 0;
          }
          const refs = [
            ...config.planning.issues.map(
              (i: { number: number; url: string; state: string; updatedAt?: string }) => ({
                ...i,
                __typename: 'Issue',
              })
            ),
            ...allPulls,
          ];
          const unique = new Map(
            refs.map((i: { number: number; __typename: string }) => [
              `${i.__typename}/${i.number}`,
              i,
            ])
          );
          const pages = config.planning.openPullPages;
          reply([
            {
              data: {
                user: {
                  projectV2: {
                    id: 'P7',
                    items: {
                      nodes: [...unique.values()].map(
                        (value: { number: number; __typename: string; updatedAt?: string }) => {
                          return {
                            id: `${value.__typename}/${value.number}`,
                            updatedAt: value.updatedAt ?? '2026-11-13T00:00:00Z',
                            isArchived: false,
                            content: {
                              ...value,
                              updatedAt: value.updatedAt ?? '2026-11-13T00:00:00Z',
                            },
                          };
                        }
                      ),
                      pageInfo: {
                        hasNextPage:
                          pages?.at(-1)?.data.repository.pullRequests.pageInfo.hasNextPage ?? false,
                        endCursor: null,
                      },
                    },
                  },
                },
              },
            },
          ]);
        } else if (/[ip]\d+:(?:issue|pullRequest)\(number:/.test(query)) {
          const values: Record<string, unknown> = {};
          for (const match of query.matchAll(/([ip]\d+):(issue|pullRequest)\(number:(\d+)\)/g)) {
            const n = Number(match[3]);
            values[match[1]] =
              match[2] === 'issue'
                ? projectIssue(n)
                : (config.planning.hydratedPulls?.[n] ??
                  allPulls.find((p: { number: number }) => p.number === n) ??
                  null);
          }
          reply({ data: { repository: values } });
        } else if (args.join(' ').includes('pullRequests(first:100,states:OPEN'))
          reply(
            config.planning.openPullPages ?? [
              {
                data: {
                  repository: {
                    pullRequests: {
                      nodes: config.planning.openPulls ?? [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                },
              },
            ]
          );
        else if (/pullRequest\(number:\d+\)/.test(args.join(' '))) {
          const n = Number(args.join(' ').match(/pullRequest\(number:(\d+)\)/)![1]);
          const pr =
            config.planning.hydratedPulls?.[n] ??
            [
              ...(config.planning.openPulls ?? []),
              ...Object.values(config.planning.nativePulls ?? {}).flat(),
            ].find((pr: { number: number }) => pr.number === n);
          reply({ data: { repository: { pullRequest: pr ?? null } } });
        } else if (args.join(' ').includes('c0:node(id:')) {
          const values: Record<string, { isRequired: boolean } | null> = {};
          for (const match of args.join(' ').matchAll(/(c\d+):node\(id:"([^"]+)"/g))
            values[match[1]] =
              typeof config.planning.requiredChecks?.[match[2]] === 'boolean'
                ? { isRequired: config.planning.requiredChecks[match[2]] }
                : null;
          reply({ data: values });
        } else if (args.join(' ').includes('issues(first:100,states:OPEN')) {
          const conn = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false } });
          const nodes = config.planning.issues.map(
            (issue: { parent?: unknown; labels: unknown[]; comments: unknown[] }) => ({
              ...issue,
              parent: issue.parent ?? null,
              labels: conn(issue.labels),
              assignees: conn([]),
              comments: { totalCount: issue.comments.length },
              projectItems: conn(config.planning.projectItems ?? []),
            })
          );
          reply([
            {
              data: {
                repository: {
                  issues: { nodes, pageInfo: { hasNextPage: false, endCursor: null } },
                },
              },
            },
          ]);
        } else {
          const n = Number(args.join(' ').match(/issue\(number:(\d+)\)/)?.[1]);
          const issue =
            config.planning.issues.find((i: { number: number }) => i.number === n) ??
            config.planning.context;
          const conn = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false } });
          reply({
            data: {
              repository: {
                issue: {
                  ...issue,
                  parent:
                    config.planning.foreignParent ??
                    (config.planning.parent
                      ? {
                          number: config.planning.parent,
                          url: `https://github.com/rafaeltab/wallpaperdb/issues/${config.planning.parent}`,
                        }
                      : null),
                  labels: conn(issue.labels),
                  assignees: conn([]),
                  comments: { totalCount: issue.comments.length },
                  projectItems: {
                    ...conn(config.planning.projectItems ?? []),
                    pageInfo: { hasNextPage: config.planning.incompleteMetadata ?? false },
                  },
                  closedByPullRequestsReferences: conn(config.planning.nativePulls?.[n] ?? []),
                  timelineItems: conn([]),
                },
              },
            },
          });
        }
      } else if (args[0] === 'api')
        reply([
          (config.planning.blockers ?? []).map((b: { number: number }) => ({
            html_url: `https://github.com/rafaeltab/wallpaperdb/issues/${b.number}`,
            ...b,
          })),
        ]);
      else
        reply(
          config.planning.issues.find((i: { number: number }) => i.number === Number(args[2])) ??
            config.planning.context
        );
    } else if (
      config.planner &&
      args[1] === 'start' &&
      !args.includes('--help') &&
      !args.includes('--worktree')
    ) {
      const prompt = args[3] === '-' ? readFileSync(0, 'utf8') : args[3];
      if (prompt.length > 120000 || config.planner.rejectStart) {
        console.error(JSON.stringify({ code: -32602, message: 'message: maximum length 120000' }));
        process.exit(1);
      }
      const request = JSON.parse(prompt.split('Request: ')[1].split('\n')[0]);
      writeFileSync(
        join(config.directory, 'planner.json'),
        JSON.stringify({
          ...request,
          options: args.includes('--execution-options')
            ? JSON.parse(flag('--execution-options'))
            : [],
          runtimeMode: args.includes('--permission-level')
            ? flag('--permission-level') || 'full-access'
            : 'full-access',
          prompt,
          model: flag('--model'),
        })
      );
      writeFileSync(join(config.directory, 'planner-settled'), 'false');
      writeFileSync(join(config.directory, 'planner-interrupted'), 'false');
      if (config.planner.lostStart) process.exit(1);
      reply({ threadId: 'planner-thread', projectId: 'project-id', runId: 'planner-run' });
    } else if (config.planner && args[1] === 'show' && args[2] === 'planner-thread') {
      await hold('planner-observation');
      const { requestId, model } = JSON.parse(
        readFileSync(join(config.directory, 'planner.json'), 'utf8')
      );
      reply({
        thread: {
          threadId: 'planner-thread',
          latestRunId: config.planner.runId ?? 'planner-run',
          status:
            config.planner.interruptCompletes &&
            readFileSync(join(config.directory, 'planner-interrupted'), 'utf8') === 'true'
              ? 'interrupted'
              : (config.planner.status ?? 'completed'),
          settled:
            existsSync(join(config.directory, 'planner-settled')) &&
            readFileSync(join(config.directory, 'planner-settled'), 'utf8') === 'true',
          providerInstanceId: 'codex',
          model: model ?? 'gpt-6.1-sol',
        },
        messages: [
          {
            role: config.planner.role ?? 'assistant',
            runId: 'planner-run',
            text: config.planner.malformed
              ? '{}'
              : JSON.stringify({
                  requestId: config.planner.responseRequestId ?? requestId,
                  ...config.planner.proposal,
                }),
          },
        ],
      });
    } else if (basename(process.argv[1]) === 'gh') {
      if (config.githubMalformed) console.log('{}');
      else if (args[0] === 'api')
        reply(args[1]?.includes('/actions/runs/') ? config.jobs : [config.blockers ?? []]);
      else if (args[0] === 'pr' && args[1] === 'list') {
        const prs =
          config.prs ??
          (existsSync(join(config.directory, 'pr.json'))
            ? [JSON.parse(readFileSync(join(config.directory, 'pr.json'), 'utf8'))]
            : []);
        reply(
          config.respectPRFilters
            ? prs.filter(
                (pr: { headRefName: string; baseRefName: string }) =>
                  pr.headRefName === args[args.indexOf('--head') + 1] &&
                  (!args.includes('--base') || pr.baseRefName === args[args.indexOf('--base') + 1])
              )
            : prs
        );
      } else if (
        args[0] === 'pr' &&
        args[1] === 'view' &&
        args.includes('url,headRefOid,headRefName,baseRefName,baseRefOid,state') &&
        (config.prs?.length || existsSync(join(config.directory, 'pr.json')))
      )
        reply(
          config.prs?.[0] ?? JSON.parse(readFileSync(join(config.directory, 'pr.json'), 'utf8'))
        );
      else if (args[0] === 'pr')
        reply({
          baseRefName: 'main',
          baseRefOid: config.base ?? 'a'.repeat(40),
          headRefOid: config.prerequisiteHeads?.[args[2]] ?? config.prHead ?? 'a'.repeat(40),
          state: 'OPEN',
          url: `https://github.com/rafaeltab/wallpaperdb/pull/${args[2]}`,
          headRefName: `factory/pr-${args[2]}`,
          mergeable: 'MERGEABLE',
          statusCheckRollup: ['Build, Lint, and Test', 'E2E Tests', 'Container E2E Tests'].map(
            (name: string) => ({
              name,
              status: 'COMPLETED',
              conclusion: config.prerequisiteCI ?? 'SUCCESS',
            })
          ),
        });
      else
        reply({
          number: Number(args[2]),
          title: config.issueTitle ?? 'Controlled issue',
          state: config.issueStates?.[args[2]] ?? 'OPEN',
          author: { login: 'rafaeltab' },
          url: `https://github.com/rafaeltab/wallpaperdb/issues/${args[2]}`,
          body:
            config.body ??
            Object.entries(config.prerequisiteHeads ?? { 591: config.prHead })
              .filter(([, sha]) => sha)
              .map(([pr, sha]) => `https://github.com/rafaeltab/wallpaperdb/pull/${pr} ${sha}`)
              .join('\n'),
          labels: [{ name: 'ready-for-agent' }],
        });
    } else if (args[0] === 'acp-mcp-call') {
      if (args[1] === 'list_thread_pull_requests') {
        const input = JSON.parse(args[2]);
        if (config.watcherPages) {
          reply(config.watcherPages[input.cursor ?? 'first']);
          process.exit(0);
        }
        if (config.watcherReplies?.[input.threadId]) {
          reply(config.watcherReplies[input.threadId]);
          process.exit(0);
        }
        reply(config.associationReply ?? { structuredContent: { pullRequests: [] } });
        process.exit(0);
      }
      if (args[1] === 't3_thread_read' && JSON.parse(args[2]).threadId === 'planner-thread') {
        reply({
          structuredContent: {
            thread: {
              threadId: 'planner-thread',
              latestRunId: config.planner.runId ?? 'planner-run',
            },
            recentRuns: [
              {
                runId: config.planner.runId ?? 'planner-run',
                completedAt: config.planner.completedAt ?? null,
              },
            ],
          },
        });
        process.exit(0);
      }
      if (config.mcpReply) {
        reply(config.mcpReply);
        process.exit(0);
      }
      if (config.activityPages) {
        const position = JSON.parse(args[2]).afterPosition;
        reply({
          structuredContent: config.activityPages[position === undefined ? 0 : position + 1],
        });
        process.exit(0);
      }
      if (args[1] === 't3_thread_interrupt')
        reply({ structuredContent: { status: 'interrupt_requested', threadId: 'thread-live' } });
      else {
        const input = JSON.parse(args[2]);
        const path = join(
          config.directory,
          config.parallel ? `resource-${input.threadId.replaceAll('/', '-')}.json` : 'resource.json'
        );
        const resourceExists = existsSync(path);
        const resource = resourceExists ? JSON.parse(readFileSync(path, 'utf8')) : {};
        reply({
          structuredContent: {
            thread: {
              activeRunId: null,
              pendingRequestCount: 0,
              pendingBackgroundTasks: [],
              ...resource,
              blockedOnThreadWait:
                config.waitingForGithub === true && resource.stage === 'babysitting',
              ...config.overrides,
              status: stageHeld(resource)
                ? 'running'
                : (config.overrides?.status ?? resource.status ?? 'completed'),
              pullRequests: (config.overrides?.pullRequests ?? []).map((pr: object) => ({
                watching: false,
                ...pr,
              })),
              ...(config.omitActivityPullRequests ? { pullRequests: undefined } : {}),
              ...(config.descendantSnapshots?.[input.threadId] ?? {}),
              threadId: input.threadId,
              latestRunId:
                config.overrides?.latestRunId ?? (resourceExists ? resource.latestRunId : null),
            },
            items: config.activity ?? [],
            hasMore: false,
            nextPosition: null,
          },
        });
      }
    } else if (args.includes('--help'))
      console.log(`--worktree --model${config.idempotency ? ' --client-request-id' : ''}`);
    else if (args[1] === 'start') {
      if (config.unavailableStart) throw new Error('Controlled unavailable launch response');
      if (
        !['gpt-6.1-sol', 'gpt-6.2-sol'].includes(flag('--model')) ||
        flag('--provider') !== 'codex' ||
        args[2] !== 'project-id'
      )
        process.exit(3);
      const worktree = join(
        config.directory,
        config.parallel ? `worker-${flag('--branch').replaceAll('/', '-')}` : 'worker'
      );
      execFileSync(
        'git',
        ['worktree', 'add', '-b', flag('--branch'), worktree, flag('--worktree')],
        {
          cwd: config.repository,
          stdio: 'pipe',
        }
      );
      writeFileSync(
        join(
          config.directory,
          config.parallel
            ? `resource-${flag('--branch').replaceAll('/', '-')}.json`
            : 'resource.json'
        ),
        JSON.stringify({
          instructions: [{ role: 'user', text: args[3] }],
          issue: args[3].match(/issues\/(\d+)/)?.[1],
          threadId: config.parallel ? flag('--branch') : 'thread-live',
          projectId: 'project-id',
          title: flag('--title'),
          providerInstanceId: 'codex',
          model: flag('--model') || 'gpt-6.1-sol',
          options: args.includes('--execution-options')
            ? JSON.parse(flag('--execution-options'))
            : [],
          runtimeMode: args.includes('--permission-level')
            ? flag('--permission-level') || 'full-access'
            : 'full-access',
          branch: flag('--branch'),
          worktreePath: worktree,
          status: config.complete ? 'completed' : 'running',
          latestRunId: 'run-1',
          runCount: 1,
          pendingRequestCount: 0,
          pullRequests: [],
        })
      );
      if (config.lost) process.exit(1);
      reply({
        threadId: config.parallel ? flag('--branch') : 'thread-live',
        projectId: 'project-id',
        runId: 'run-1',
      });
    } else if (args[1] === 'send') {
      const path = join(
        config.directory,
        config.parallel ? `resource-${args[2].replaceAll('/', '-')}.json` : 'resource.json'
      );
      const resource = JSON.parse(readFileSync(path, 'utf8'));
      const index = Number(args[3].match(/Stage (\d+) of factory/)![1]);
      resource.runCount = Math.max(resource.runCount, config.overrides?.runCount ?? 0) + 1;
      resource.instructions = [...(resource.instructions ?? []), { role: 'user', text: args[3] }];
      resource.stageIndex = index;
      resource.stage = args[3].includes('$babysit-pr')
        ? 'babysitting'
        : args[3].includes('$review-loop')
          ? 'review'
          : args[3].includes('$implement')
            ? 'implementation'
            : 'publication';
      resource.latestRunId = `run-${resource.runCount}`;
      resource.status = config.complete ? 'completed' : 'running';
      if (resource.stage === 'publication') {
        const pr = existsSync(join(config.directory, 'pr.json'))
          ? JSON.parse(readFileSync(join(config.directory, 'pr.json'), 'utf8'))
          : {
              url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
              headRefName: resource.branch,
              baseRefName: 'main',
              headRefOid: config.base,
              baseRefOid: config.base,
              state: 'OPEN',
              isDraft: false,
              mergeable: 'MERGEABLE',
              statusCheckRollup: ['Build, Lint, and Test', 'E2E Tests', 'Container E2E Tests'].map(
                (name: string) => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' })
              ),
            };
        if (!existsSync(join(config.directory, 'pr.json')))
          writeFileSync(join(config.directory, 'pr.json'), JSON.stringify(pr));
        resource.pullRequests = [{ url: pr.url }];
      }
      writeFileSync(path, JSON.stringify(resource));
      if (config.lostSend || (config.lostPublication && index === 2)) process.exit(1);
      const sent = { threadId: resource.threadId, runId: resource.latestRunId };
      reply(mcpSend ? { structuredContent: sent } : sent);
    } else {
      if (['list', 'show'].includes(args[1]) && config.delayObserve) {
        writeFileSync(
          join(
            config.directory,
            environment.FACTORY_WS_FIXTURE ? 'observing-websocket' : 'observing.pid'
          ),
          environment.FACTORY_WS_FIXTURE ? 'held' : String(process.pid)
        );
        const { setTimeout: delay } = await import('node:timers/promises');
        await delay(30000, undefined, { signal });
      }
      const parallelResources = config.parallel
        ? readdirSync(config.directory)
            .filter((name: string) => name.startsWith('resource-'))
            .map((name: string) => JSON.parse(readFileSync(join(config.directory, name), 'utf8')))
        : [];
      const resource = config.parallel
        ? parallelResources.find((item) => item.threadId === args[2])
        : existsSync(join(config.directory, 'resource.json'))
          ? JSON.parse(readFileSync(join(config.directory, 'resource.json'), 'utf8'))
          : null;
      if (resource && args[1] === 'show') Object.assign(resource, config.overrides);
      if (config.malformed) console.log('{broken');
      else if (args[1] === 'list')
        reply(
          config.omitThreadList
            ? []
            : config.parallel
              ? parallelResources
              : resource
                ? config.duplicate
                  ? [resource, resource]
                  : [resource]
                : []
        );
      else if (args[1] === 'show')
        reply({
          thread: resource
            ? {
                ...resource,
                ...config.overrides,
                ...(stageHeld(resource) ? { status: 'running' } : {}),
                ...(config.omitTranscriptPullRequests ? { pullRequests: undefined } : {}),
              }
            : null,
          messages: config.messages
            ? [
                ...(config.omitInstructionHistory ? [] : (resource?.instructions ?? [])),
                ...config.messages,
              ]
            : (((config.holdPublication && resource?.stage === 'publication') ||
              (config.holdReview && resource?.stage === 'review')
                ? []
                : config.messages) ??
              (config.complete && resource
                ? [
                    ...(resource.instructions ?? []),
                    {
                      role: 'assistant',
                      runId: resource.latestRunId,
                      text: JSON.stringify({
                        version: 1,
                        kind: 'state',
                        jobId:
                          resource.title.match(/\[factory:(.*)\]$/)?.[1] ?? resource.title.slice(8),
                        implemented: resource.issue ?? '577',
                        base: config.base,
                        checked: config.base,
                        ...(resource.stage !== 'implementation' && resource.stage
                          ? { reviewed: config.base }
                          : {}),
                        ...(['publication', 'babysitting'].includes(resource.stage)
                          ? { published: config.base }
                          : {}),
                        checks: {
                          format: true,
                          lint: true,
                          tests: true,
                          coverage: true,
                          crap: true,
                        },
                      }),
                    },
                  ]
                : null) ?? [{ text: '<TASK>COMPLETE</TASK>', role: 'user' }]),
        });
    }
    return 0;
  } catch (error) {
    if (error instanceof ProtocolExit) return error.code;
    throw error;
  }
}

if (nodeProcess.argv[1] && import.meta.url === pathToFileURL(nodeProcess.argv[1]).href) {
  const argv = [
    nodeProcess.argv[0],
    basename(nodeProcess.argv[1], '.mjs'),
    ...nodeProcess.argv.slice(2),
  ];
  nodeProcess.exitCode = await runProtocol(nodeProcess.env, argv, console);
}
