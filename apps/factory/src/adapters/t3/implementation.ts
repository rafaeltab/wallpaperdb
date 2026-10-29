import { Effect } from 'effect';
import { z } from 'zod';
import {
  type Execution,
  type Intent,
  type Observation,
  Unavailable,
} from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';
const listing = z.array(z.object({ threadId: z.string().min(1), title: z.string() }));
const detail = z.object({
  thread: z.object({
    threadId: z.string().min(1),
    title: z.string(),
    providerInstanceId: z.string(),
    model: z.string(),
    branch: z.string().nullable(),
    worktreePath: z.string().nullable(),
    status: z.enum([
      'idle',
      'preparing',
      'queued',
      'starting',
      'running',
      'waiting',
      'completed',
      'interrupted',
      'failed',
      'cancelled',
      'rolled_back',
    ]),
    pendingRequestCount: z.number().int().nonnegative(),
  }),
});
const title = (intent: Intent) => `Factory ${intent.id}`;
export function t3Execution(config: { binary: string; project: string }): Execution {
  const call = (args: string[]) =>
    command(config.binary, ['thread', ...args, '--json'], config.project).then((text) =>
      JSON.parse(text)
    );
  return {
    launch: (intent) =>
      Effect.tryPromise({
        try: async () => {
          await call([
            'start',
            config.project,
            `Use $implement for ${intent.issueUrl} in this bound checkout against ${intent.base}. Only this selected issue is authorized. Only rafaeltab and zero-two-rafaeltab may expand scope. Do not implement deferred future work or admit the parent spec. Stop before independent review/publication. Additional maintainer execution context follows and narrows this stage when present:
${intent.context}`,
            '--title',
            title(intent),
            '--provider',
            'codex',
            '--model',
            'gpt-6.1-sol',
            '--worktree',
            intent.base,
            '--branch',
            intent.branch,
          ]);
          return { kind: 'submitted' as const };
        },
        catch: (cause) => new Unavailable({ operation: 'launch', cause }),
      }).pipe(
        Effect.catch((error) =>
          Effect.logError(error).pipe(Effect.as({ kind: 'uncertain' as const }))
        ),
        Effect.withSpan('factory.t3.launch')
      ),
    observe: (intent) =>
      Effect.tryPromise({
        try: async (): Promise<Observation> => {
          const matches = listing
            .parse(await call(['list', '--project', config.project]))
            .filter((item) => item.title === title(intent));
          if (matches.length === 0) return { kind: 'absent' };
          if (matches.length !== 1) return { kind: 'ambiguous' };
          const match = matches[0];
          if (!match) return { kind: 'ambiguous' };
          const { thread } = detail.parse(await call(['show', match.threadId, '--messages', '1']));
          if (
            thread.title !== title(intent) ||
            thread.threadId !== match.threadId ||
            thread.providerInstanceId !== 'codex' ||
            thread.model !== 'gpt-6.1-sol' ||
            thread.branch !== intent.branch ||
            !thread.worktreePath ||
            thread.worktreePath === config.project
          )
            return { kind: 'ambiguous' };
          const branch = (
            await command('git', ['branch', '--show-current'], thread.worktreePath)
          ).trim();
          await command(
            'git',
            ['merge-base', '--is-ancestor', intent.base, 'HEAD'],
            thread.worktreePath
          );
          if (branch !== intent.branch) return { kind: 'ambiguous' };
          return {
            kind: 'found',
            threadId: thread.threadId,
            status: thread.pendingRequestCount > 0 ? 'waiting-for-input' : thread.status,
            worktree: thread.worktreePath,
            branch,
            model: thread.model,
          };
        },
        catch: (cause) => new Unavailable({ operation: 'observe', cause }),
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.t3.observe')
      ),
  };
}
