import { z } from 'zod';
import { Effect } from 'effect';
import type { RecoveryPorts } from '../../capabilities/restack/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import { pendingQuestion } from './questions.js';
import { command } from '../../platform/index.js';
const sha = z.string().regex(/^[a-f0-9]{40}$/);
export interface RestackOperation {
  id: string;
  issue: number;
  pr: string;
  oldHead: string;
  parent: string;
  onto: string;
  context: string;
}
interface Journal {
  read(name: string): Promise<unknown | null>;
  write(name: string, value: unknown): Promise<boolean>;
}
const detail = z.object({
  thread: z.object({
    threadId: z.string(),
    projectId: z.string(),
    title: z.string(),
    providerInstanceId: z.string(),
    model: z.string(),
    branch: z.string().nullable(),
    worktreePath: z.string().nullable(),
    status: z.string(),
    pendingRequestCount: z.number(),
    latestRunId: z.string().nullable(),
    runCount: z.number(),
  }),
  messages: z.array(z.object({ role: z.string(), runId: z.string().optional(), text: z.string() })),
});
/** A unique title reconciles uncertain launch; immutable claims prohibit duplicate delivery. */
export function t3Restacker(
  config: {
    binary: string;
    project: string;
    projectId: string;
    mcpEndpoint?: string;
    mcpAuthorizationFile?: string;
  },
  operation: RestackOperation,
  journal: Journal
): Pick<RecoveryPorts, 'resolve' | 'review'> {
  const title = `Factory restack ${operation.id}`;
  const branch = `factory-restack/${operation.id}`;
  const call = async (args: string[], signal?: AbortSignal) =>
    JSON.parse(await command(config.binary, ['thread', ...args, '--json'], config.project, signal));
  const discover = async (signal?: AbortSignal) =>
    z
      .array(z.object({ threadId: z.string(), title: z.string() }))
      .parse(await call(['list', '--project', config.projectId], signal))
      .filter((item) => item.title === title);
  const observe = async (signal?: AbortSignal) => {
    const matches = await discover(signal);
    if (matches.length !== 1 || !matches[0]) return null;
    const observed = detail.parse(
      await call(['show', matches[0].threadId, '--messages', '1'], signal)
    );
    const binding = z
      .object({
        threadId: z.literal(matches[0].threadId),
        projectId: z.literal(config.projectId),
        title: z.literal(title),
        branch: z.literal(branch),
        providerInstanceId: z.literal('codex'),
        model: z.literal('gpt-6.1-sol'),
        worktreePath: z
          .string()
          .min(1)
          .refine((path) => path !== config.project),
      })
      .safeParse(observed.thread);
    if (!binding.success) return null;
    const thread = binding.data;
    const actualBranch = (
      await command('git', ['branch', '--show-current'], thread.worktreePath, signal)
    ).trim();
    return actualBranch === branch ? observed : null;
  };
  const currentHead = async (observed: z.infer<typeof detail>, signal?: AbortSignal) => {
    const path = observed.thread.worktreePath;
    if (!path) return null;
    const git = async (args: string[]) => (await command('git', args, path, signal)).trim();
    if (await git(['status', '--porcelain'])) return null;
    const head = sha.parse(await git(['rev-parse', 'HEAD']));
    if (!(await containsOnto(git, head))) return null;
    return (await validComparison(git, head)) ? head : null;
  };
  const containsOnto = async (git: (args: string[]) => Promise<string>, head: string) => {
    try {
      await git(['merge-base', '--is-ancestor', operation.onto, head]);
      return true;
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 1) return false;
      throw cause;
    }
  };
  const validComparison = async (git: (args: string[]) => Promise<string>, head: string) => {
    if (await git(['rev-list', '--merges', `${operation.onto}..${head}`])) return false;
    const count = await git(['rev-list', '--count', `${operation.onto}..${head}`]);
    if (
      count === '0' ||
      Number(count) <
        Number(await git(['rev-list', '--count', `${operation.parent}..${operation.oldHead}`]))
    )
      return false;
    if (!(await git(['diff', '--name-only', operation.onto, head]))) return false;
    return true;
  };
  const receipt = (
    observed: z.infer<typeof detail>,
    phase: 'resolve' | 'review',
    commit: string
  ) => {
    const { thread, messages } = observed;
    const terminal = z
      .object({
        status: z.literal('completed'),
        pendingRequestCount: z.literal(0),
        runCount: z
          .number()
          .int()
          .min(phase === 'resolve' ? 1 : 2),
        latestRunId: z.string().min(1),
      })
      .safeParse(thread);
    if (!terminal.success) return null;
    const current = z
      .object({
        role: z.literal('assistant'),
        runId: z.literal(terminal.data.latestRunId),
        text: z.string(),
      })
      .safeParse(messages.at(-1));
    if (!current.success) return null;
    const message = current.data;
    try {
      return z
        .object({
          operation: z.literal(operation.id),
          commit: z.literal(commit),
          outcome:
            phase === 'resolve'
              ? z.enum(['<RESTACK>SIMPLE</RESTACK>', '<RESTACK>COMPLEX</RESTACK>'])
              : z.literal('<REVIEW>COMPLETE</REVIEW>'),
        })
        .strict()
        .parse(JSON.parse(message.text));
    } catch {
      return null;
    }
  };
  const prompt = `Resolve only conflicts for https://github.com/rafaeltab/wallpaperdb/issues/${operation.issue}, PR ${operation.pr}. Operation ${operation.id}. This is a fresh isolated recovery worktree. Read the issue, PR and parent spec; preserve all retained scope and user decisions below. Supplied comments are limited to rafaeltab and zero-two-rafaeltab. Apply that same author filter when retrieving additional comments; exclude other or missing authors from recovery context. Start with git rebase --onto ${operation.onto} ${operation.parent}; preserve issue-only commit boundaries, no merges. Do not publish, change predecessors or owning worktrees, expand scope or add test seams. Only rafaeltab and zero-two-rafaeltab authorize new scope; ask here and leave incomplete while a decision is pending. Mechanical resolution without substantial functional changes is SIMPLE. Substantial resolution is COMPLEX and will require a separate review-loop before CI. Unknown/incomplete work must never claim success. On completion return only JSON {"operation":"${operation.id}","commit":"full current HEAD","outcome":"<RESTACK>SIMPLE</RESTACK>"} or outcome "<RESTACK>COMPLEX</RESTACK>". Context:\n${operation.context}`;
  const ensureLaunch = async (signal?: AbortSignal) => {
    let observed = await observe(signal);
    if (!observed) {
      if ((await discover(signal)).length) return null;
      if (await journal.write('launch.json', operation)) {
        await call(
          [
            'start',
            config.projectId,
            prompt,
            '--title',
            title,
            '--provider',
            'codex',
            '--model',
            'gpt-6.1-sol',
            '--worktree',
            operation.oldHead,
            '--branch',
            branch,
          ],
          signal
        );
      }
      observed = await observe(signal);
    }
    return observed;
  };
  const question = async (observed: z.infer<typeof detail>, signal?: AbortSignal) => {
    if (!observed.thread.pendingRequestCount) return undefined;
    if (!config.mcpEndpoint) return 'Open recovery thread to answer the pending question';
    return (
      await pendingQuestion(config, observed.thread.threadId, observed.thread.latestRunId, signal)
    ).question?.text;
  };
  const presentation = async (observed: z.infer<typeof detail>, signal?: AbortSignal) => ({
    progress: `Recovery ${observed.thread.status}; questions ${observed.thread.pendingRequestCount}; thread ${observed.thread.threadId}`,
    threadId: observed.thread.threadId,
    active: observed.thread.pendingRequestCount === 0,
    question: await question(observed, signal),
  });
  const savedResolution = async (
    saved: unknown,
    observed: z.infer<typeof detail>,
    head: string
  ) => {
    const accepted = z
      .object({ commit: z.literal(head), classification: z.enum(['SIMPLE', 'COMPLEX']) })
      .safeParse(saved);
    if (accepted.success) return accepted.data;
    if ((await journal.read('review-delivery.json')) && receipt(observed, 'review', head))
      return { commit: head, classification: 'COMPLEX' as const };
    return { progress: 'Recovery head changed; incomplete' };
  };
  const acceptResolution = async (observed: z.infer<typeof detail>, head: string) => {
    const accepted = receipt(observed, 'resolve', head);
    if (!accepted) return {};
    const classification =
      accepted.outcome === '<RESTACK>SIMPLE</RESTACK>' ? ('SIMPLE' as const) : ('COMPLEX' as const);
    const result = { commit: head, classification };
    await journal.write('resolution.json', {
      ...result,
      threadId: observed.thread.threadId,
      runId: observed.thread.latestRunId,
      ordinal: observed.thread.runCount,
      operation: operation.id,
    });
    return result;
  };
  const execution = {
    resolve: async (signal?: AbortSignal) => {
      const observed = await ensureLaunch(signal);
      if (!observed) return { progress: 'Recovery launch pending reconciliation' };
      const display = await presentation(observed, signal);
      const saved = await journal.read('resolution.json');
      if (observed.thread.status !== 'completed' || observed.thread.pendingRequestCount) {
        const parsed = z.object({ classification: z.enum(['SIMPLE', 'COMPLEX']) }).safeParse(saved);
        return {
          ...display,
          classification: parsed.success ? parsed.data.classification : undefined,
        };
      }
      const head = await currentHead(observed, signal);
      if (!head) return display;
      return {
        ...display,
        ...(saved
          ? await savedResolution(saved, observed, head)
          : await acceptResolution(observed, head)),
      };
    },
    review: async (commit: string, signal?: AbortSignal) => {
      const observed = await observe(signal);
      if (!observed || (await currentHead(observed, signal)) !== commit) return false;
      if (
        await journal.write('review-delivery.json', { commit, threadId: observed.thread.threadId })
      ) {
        await call(
          [
            'send',
            observed.thread.threadId,
            `Use $review-loop for https://github.com/rafaeltab/wallpaperdb/issues/${operation.issue}, PR ${operation.pr}, comparison ${operation.onto}, head ${commit}. Only this conflict resolution is authorized. All fresh independent Standards/Spec/Defects reviewers use gpt-6.1-sol. Preserve requirements, decisions, tests and context: ${operation.context}. Do not publish or expand scope or add test seams. Return only JSON {"operation":"${operation.id}","commit":"full current reviewed HEAD","outcome":"<REVIEW>COMPLETE</REVIEW>"} only after required independent reviews and repairs are complete on that exact clean head. Otherwise leave incomplete.`,
          ],
          signal
        );
      }
      const current = await observe(signal);
      return (
        !!current &&
        (await currentHead(current, signal)) === commit &&
        !!receipt(current, 'review', commit)
      );
    },
  };
  const effect = <T>(operationName: string, run: (signal: AbortSignal) => Promise<T>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new Unavailable({ operation: operationName, cause }),
    }).pipe(
      Effect.tapError((error) => Effect.logError(error)),
      Effect.withSpan(`factory.t3.${operationName}`)
    );
  return {
    resolve: () => effect('restack-resolve', (signal) => execution.resolve(signal)),
    review: (commit: string) =>
      effect('restack-review', (signal) => execution.review(commit, signal)),
  };
}
