import { Effect } from 'effect';
import { z } from 'zod';
import { Unavailable } from '../../capabilities/job/index.js';
import type { ThreadSource, ThreadMetadata } from '../../capabilities/observe/index.js';
import { mcpCall } from './questions.js';
const pull = z.object({
  repository: z.string().min(1),
  number: z.number().int().positive(),
  url: z.string().url(),
  source: z.string().optional(),
});
const page = z.object({
  threads: z.array(
    z.object({
      threadId: z.string().min(1),
      title: z.string(),
      createdAt: z.string().datetime().nullish(),
      updatedAt: z.string().datetime().nullish(),
      status: z.string().min(1).max(200),
      pullRequests: z.array(pull).optional(),
      linkedPullRequest: pull.nullable().optional(),
    })
  ),
  nextCursor: z.number().int().nonnegative().nullable(),
});
/** Only metadata-only MCP operations. thread show/read fetches conversation content. */
export function t3Metadata(config: {
  binary: string;
  project: string;
  projectId: string;
  mcpEndpoint?: string;
  mcpAuthorizationFile?: string;
}): ThreadSource {
  return {
    read: () =>
      Effect.tryPromise({
        try: async (signal) => {
          const { environmentId } = z
            .object({ environmentId: z.string().min(1) })
            .parse(await mcpCall(config, 't3_environment_read', {}, signal));
          const threads: ThreadMetadata[] = [];
          let cursor: number | null = 0;
          const seen = new Set<number>();
          while (cursor !== null) {
            if (seen.has(cursor) || seen.size >= 100)
              throw new Error('Invalid or excessive T3 pagination');
            seen.add(cursor);
            const result = page.parse(
              await mcpCall(
                config,
                't3_thread_list',
                { projectId: config.projectId, includeSubagents: false, limit: 100, cursor },
                signal
              )
            );
            for (const row of result.threads)
              threads.push({
                threadId: row.threadId,
                title: row.title,
                createdAt: row.createdAt ?? null,
                updatedAt: row.updatedAt ?? null,
                status: row.status,
                branch: null,
                worktree: null,
                pullRequests: (
                  row.pullRequests ?? (row.linkedPullRequest ? [row.linkedPullRequest] : [])
                )
                  .filter((pr) => pr.source !== 'stack-dismissed')
                  .map(({ repository, number, url }) => ({ repository, number, url })),
              });
            cursor = result.nextCursor;
          }
          return { environmentId, projectId: config.projectId, threads };
        },
        catch: (cause) => new Unavailable({ operation: 't3-metadata', cause }),
      }).pipe(Effect.tapError(Effect.logError), Effect.withSpan('factory.t3.metadata')),
  };
}
