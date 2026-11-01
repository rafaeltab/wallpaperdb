import { z } from 'zod';
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
) {
  const title = `Factory restack ${operation.id}`;
  const branch = `factory-restack/${operation.id}`;
  const call = async (args: string[], signal?: AbortSignal) =>
    JSON.parse(await command(config.binary, ['thread', ...args, '--json'], config.project, signal));
  const observe = async (signal?: AbortSignal) => {
    const matches = z
      .array(z.object({ threadId: z.string(), title: z.string() }))
      .parse(await call(['list', '--project', config.projectId], signal))
      .filter((item) => item.title === title);
    if (matches.length !== 1 || !matches[0]) return null;
    const observed = detail.parse(
      await call(['show', matches[0].threadId, '--messages', '1'], signal)
    );
    const thread = observed.thread;
    if (
      thread.projectId !== config.projectId ||
      thread.title !== title ||
      thread.branch !== branch ||
      thread.providerInstanceId !== 'codex' ||
      thread.model !== 'gpt-6.1-sol' ||
      !thread.worktreePath ||
      thread.worktreePath === config.project
    )
      return null;
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
    await git(['merge-base', '--is-ancestor', operation.onto, head]);
    if (await git(['rev-list', '--merges', `${operation.onto}..${head}`])) return null;
    const count = await git(['rev-list', '--count', `${operation.onto}..${head}`]);
    if (
      count === '0' ||
      count !== (await git(['rev-list', '--count', `${operation.parent}..${operation.oldHead}`]))
    )
      return null;
    if (!(await git(['diff', '--name-only', operation.onto, head]))) return null;
    return head;
  };
  const receipt = (
    observed: z.infer<typeof detail>,
    phase: 'resolve' | 'review',
    commit: string
  ) => {
    const { thread, messages } = observed;
    const message = messages.at(-1);
    if (
      thread.status !== 'completed' ||
      thread.pendingRequestCount ||
      thread.runCount !== (phase === 'resolve' ? 1 : 2) ||
      !thread.latestRunId ||
      message?.role !== 'assistant' ||
      message.runId !== thread.latestRunId
    )
      return null;
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
  const prompt = `Resolve only conflicts for https://github.com/rafaeltab/wallpaperdb/issues/${operation.issue}, PR ${operation.pr}. Operation ${operation.id}. This is a fresh isolated recovery worktree. Read the full issue, comments, PR and parent spec; preserve all retained scope and user decisions below. Start with git rebase --onto ${operation.onto} ${operation.parent}; preserve issue-only commit boundaries, no merges. Do not publish, change predecessors or owning worktrees, expand scope or add test seams. Only rafaeltab and zero-two-rafaeltab authorize new scope; ask here and leave incomplete while a decision is pending. Mechanical resolution without substantial functional changes is SIMPLE. Substantial resolution is COMPLEX and will require a separate review-loop before CI. Unknown/incomplete work must never claim success. On completion return only JSON {"operation":"${operation.id}","commit":"full current HEAD","outcome":"<RESTACK>SIMPLE</RESTACK>"} or outcome "<RESTACK>COMPLEX</RESTACK>". Context:\n${operation.context}`;
  return {
    resolve: async (signal?: AbortSignal) => {
      let observed = await observe(signal);
      if (!observed) {
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
      if (!observed) return { progress: 'Recovery launch pending reconciliation' };
      const progress = `Recovery ${observed.thread.status}; questions ${observed.thread.pendingRequestCount}; thread ${observed.thread.threadId}`;
      const display = {
        progress,
        threadId: observed.thread.threadId,
        question: observed.thread.pendingRequestCount
          ? config.mcpEndpoint
            ? (
                await pendingQuestion(
                  config,
                  observed.thread.threadId,
                  observed.thread.latestRunId,
                  signal
                )
              ).question?.text
            : 'Open recovery thread to answer the pending question'
          : undefined,
      };
      const saved = await journal.read('resolution.json');
      if (observed.thread.status !== 'completed' || observed.thread.pendingRequestCount)
        return display;
      const head = await currentHead(observed, signal);
      if (!head) return display;
      if (saved) {
        const accepted = z
          .object({ commit: z.literal(head), classification: z.enum(['SIMPLE', 'COMPLEX']) })
          .safeParse(saved);
        return accepted.success
          ? { ...accepted.data, ...display }
          : (await journal.read('review-delivery.json')) && receipt(observed, 'review', head)
            ? { commit: head, classification: 'COMPLEX' as const, ...display }
            : { progress: 'Recovery head changed; incomplete' };
      }
      const accepted = receipt(observed, 'resolve', head);
      if (!accepted) return display;
      const classification =
        accepted.outcome === '<RESTACK>SIMPLE</RESTACK>'
          ? ('SIMPLE' as const)
          : ('COMPLEX' as const);
      await journal.write('resolution.json', { commit: head, classification });
      return { commit: head, classification, ...display };
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
}
