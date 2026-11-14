import { z } from 'zod';

const thread = z.object({
  threadId: z.string(),
  parentThreadId: z.string().nullable(),
});
const snapshot = z.object({
  thread: z.object({
    threadId: z.string(),
    latestRunId: z.string().nullable(),
    activeRunId: z.string().nullable(),
    status: z.string(),
    pendingRequestCount: z.number().int().nonnegative(),
    blockedOnThreadWait: z.boolean(),
    pendingBackgroundTasks: z.array(z.unknown()),
    pullRequests: z.array(z.object({ watching: z.boolean() })),
  }),
  items: z.array(
    z.object({ status: z.string(), sourceThreadId: z.string(), visibility: z.string() })
  ),
  hasMore: z.boolean(),
  nextPosition: z.number().nullable(),
});
/** A complete supported-system snapshot, including descendants below finished parents.
 * Missing optional protocol enrichments cannot establish inactivity. */
export async function inactiveLineage(
  call: (tool: string, args: object, signal?: AbortSignal) => Promise<unknown>,
  root: string,
  expectedRun: string | null,
  signal?: AbortSignal
): Promise<'idle' | 'waiting' | 'busy'> {
  const threads: z.infer<typeof thread>[] = [];
  let cursor: number | undefined;
  const cursors = new Set<number>();
  for (;;) {
    const page = z
      .object({ threads: z.array(thread), nextCursor: z.number().nullable() })
      .parse(
        await call(
          't3_thread_list',
          { allProjects: true, includeSubagents: true, limit: 100, cursor },
          signal
        )
      );
    threads.push(...page.threads);
    if (page.nextCursor === null) break;
    if (cursors.has(page.nextCursor)) throw new Error('T3 lineage pagination did not advance');
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  if (!threads.some((t) => t.threadId === root)) return 'busy';
  const owners = new Set([root]);
  for (let size = -1; size !== owners.size; ) {
    size = owners.size;
    for (const child of threads)
      if (child.parentThreadId && owners.has(child.parentThreadId)) owners.add(child.threadId);
  }
  let waiting = false;
  for (const owner of owners) {
    const state = await inactiveThread(
      call,
      owner,
      owner === root ? expectedRun : undefined,
      signal
    );
    if (state === 'busy') return 'busy';
    waiting ||= state === 'waiting';
  }
  return waiting ? 'waiting' : 'idle';
}
async function inactiveThread(
  call: (tool: string, args: object, signal?: AbortSignal) => Promise<unknown>,
  owner: string,
  expectedRun: string | null | undefined,
  signal?: AbortSignal
): Promise<'idle' | 'waiting' | 'busy'> {
  let waiting = false;
  let afterPosition = -1;
  const positions = new Set<number>();
  for (;;) {
    const parsed = snapshot.safeParse(
      await call(
        't3_thread_read',
        { threadId: owner, view: 'activity', afterPosition, limit: 100, maxCharsPerItem: 1 },
        signal
      )
    );
    if (!parsed.success) return 'busy';
    const { thread, items, hasMore, nextPosition } = parsed.data;
    if (
      thread.threadId !== owner ||
      (expectedRun !== undefined && thread.latestRunId !== expectedRun) ||
      thread.activeRunId !== null ||
      !['idle', 'completed', 'failed', 'interrupted', 'cancelled', 'rolled_back'].includes(
        thread.status
      ) ||
      thread.pendingRequestCount !== 0 ||
      thread.pendingBackgroundTasks.length > 0 ||
      items.some(
        (item) =>
          item.sourceThreadId === owner &&
          item.visibility === 'local' &&
          ['pending', 'running', 'waiting'].includes(item.status)
      )
    )
      return 'busy';
    waiting ||= thread.blockedOnThreadWait || thread.pullRequests.some((pr) => pr.watching);
    if (!hasMore) return waiting ? 'waiting' : 'idle';
    if (nextPosition === null || positions.has(nextPosition) || nextPosition <= afterPosition)
      return 'busy';
    positions.add(nextPosition);
    afterPosition = nextPosition;
  }
}
