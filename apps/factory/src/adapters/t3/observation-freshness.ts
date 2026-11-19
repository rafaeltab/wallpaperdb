import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { shell, type Shell } from './observed-model.js';

const snapshot = z.object({
  snapshotSequence: z.number().int().nonnegative(),
  threads: z.array(shell),
});
const facts = (rows: readonly Shell[]) =>
  new Map(
    rows.map((row) => [
      row.id,
      {
        projectId: row.projectId,
        title: row.title,
        parent: row.lineage.parentThreadId,
        status: row.status,
        latestRunId: row.latestRunId,
        activeRunId: row.activeRunId,
        blockedOnThreadWait: row.blockedOnThreadWait,
        pendingBackgroundTasks: row.pendingBackgroundTasks,
        pullRequests: (row.pullRequests ?? []).filter(
          (pr) => pr.watching === true || pr.watch != null
        ),
        branch: row.branch ?? null,
        worktreePath: row.worktreePath ?? null,
      },
    ])
  );

/** Point evidence bridges shell suppression without advancing the shared replay cursor. */
export function t3FamilyFreshness(config: {
  read: (root: string) => Promise<unknown>;
  signal: AbortSignal;
  report: (cause: unknown) => void;
}) {
  const proofs = new Map<string, { sequence: number; facts: ReturnType<typeof facts> }>();
  const pending = new Map<string, Promise<void>>();
  const retryAt = new Map<string, number>();
  return {
    synchronized: (root: string, sequence: number, rows: readonly Shell[]) => {
      const proof = proofs.get(root);
      return Boolean(
        proof && proof.sequence >= sequence && isDeepStrictEqual(proof.facts, facts(rows))
      );
    },
    refresh: (root: string) => {
      if (!config.signal.aborted && !pending.has(root) && Date.now() >= (retryAt.get(root) ?? 0)) {
        const work = Promise.resolve()
          .then(async () => {
            config.signal.throwIfAborted();
            const value = snapshot.parse(await config.read(root));
            config.signal.throwIfAborted();
            const members = new Set([root]);
            for (let size = -1; size !== members.size; ) {
              size = members.size;
              for (const row of value.threads)
                if (row.lineage.parentThreadId && members.has(row.lineage.parentThreadId))
                  members.add(row.id);
            }
            proofs.set(root, {
              sequence: value.snapshotSequence,
              facts: facts(value.threads.filter((row) => members.has(row.id))),
            });
          })
          .catch((cause) => {
            if (!config.signal.aborted) config.report(cause);
          })
          .finally(() => {
            pending.delete(root);
            retryAt.set(root, Date.now() + 1000);
          });
        pending.set(root, work);
      }
    },
    close: async () => {
      await Promise.allSettled([...pending.values()]);
    },
  };
}
