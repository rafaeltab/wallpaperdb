import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { records, stateConnection } from '../../platform/index.js';

type Read = (args: string[], signal?: AbortSignal) => Promise<unknown>;
export interface ProjectSynchronizationOptions {
  directory?: string;
  now?: () => number;
}
const content = z.object({
  __typename: z.enum(['Issue', 'PullRequest']),
  number: z.number().int().positive(),
  url: z.string().url(),
  state: z.string(),
  updatedAt: z.string().datetime(),
});
const member = z.object({
  id: z.string().min(1),
  updatedAt: z.string().datetime(),
  isArchived: z.boolean(),
  content: content.nullable(),
});
const state = z.object({
  format: z.literal(1),
  revision: z.number().int().nonnegative(),
  projectId: z.string(),
  checkpoint: z.number(),
  indexedAt: z.number(),
  members: z.array(member),
  details: z.record(z.object({ marker: z.string(), fetchedAt: z.number(), value: z.unknown() })),
});
type State = z.infer<typeof state>;
const recordName = 'github-project-sync-v1';
const membershipIntervalMs = 5 * 60_000;
const timestampSettlingMs = 60_000;
const response = z.array(
  z.object({
    data: z.object({
      user: z.object({
        projectV2: z.object({
          id: z.string().min(1),
          items: z.object({
            nodes: z.array(
              z.object({
                id: z.string(),
                updatedAt: z.string(),
                isArchived: z.boolean(),
                content: z.object({ __typename: z.string() }).passthrough().nullable(),
              })
            ),
            pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
          }),
        }),
      }),
    }),
  })
);

/** A private GitHub transport cache. It cannot authorize planning or execution. */
export function projectSynchronization(options: ProjectSynchronizationOptions = {}) {
  let memory: State | undefined;
  const load = () =>
    options.directory
      ? stateConnection(options.directory, (db, namespace) => {
          const value = db
            .select()
            .from(records)
            .where(and(eq(records.namespace, namespace), eq(records.name, recordName)))
            .get()?.value;
          return value === undefined ? undefined : state.parse(value);
        })
      : memory;
  return {
    begin: async (read: Read, signal: AbortSignal) => {
      const previous = load();
      const startedAt = (options.now ?? Date.now)();
      const full =
        !previous ||
        startedAt < previous.checkpoint ||
        startedAt - previous.indexedAt >= membershipIntervalMs;
      // The public API's updated filter accepts absolute days, not ISO timestamps.
      // Include the preceding day for index lag and timestamp boundaries.
      const filter = full
        ? ''
        : `updated:>=${new Date(previous.checkpoint - 86_400_000).toISOString().slice(0, 10)}`;
      const pages = response.parse(
        await read(
          [
            'api',
            'graphql',
            '--paginate',
            '--slurp',
            '-f',
            `query=query($endCursor:String) { user(login:"rafaeltab") { projectV2(number:7) { id items(first:100,after:$endCursor,query:${JSON.stringify(filter)}) { nodes { id updatedAt isArchived content { __typename ... on Issue { number url state updatedAt } ... on PullRequest { number url state updatedAt } } } pageInfo { hasNextPage endCursor } } } } }`,
          ],
          signal
        )
      );
      if (!pages.length || pages.at(-1)?.data.user.projectV2.items.pageInfo.hasNextPage)
        throw new Error('Incomplete project synchronization');
      const projectId = pages[0].data.user.projectV2.id;
      if (previous && previous.projectId !== projectId)
        throw new Error('Project synchronization identity changed');
      const members = new Map((full ? [] : previous.members).map((item) => [item.id, item]));
      const seen = new Set<string>();
      for (const [offset, page] of pages.entries()) {
        const { items } = page.data.user.projectV2;
        if (
          page.data.user.projectV2.id !== projectId ||
          (offset < pages.length - 1 && (!items.pageInfo.hasNextPage || !items.pageInfo.endCursor))
        )
          throw new Error('Invalid project pagination');
        for (const raw of items.nodes) {
          if (seen.has(raw.id)) throw new Error('Duplicate project item during pagination');
          seen.add(raw.id);
          const linked =
            raw.content && ['Issue', 'PullRequest'].includes(raw.content.__typename)
              ? content.parse(raw.content)
              : null;
          const local =
            linked &&
            /^https:\/\/github.com\/rafaeltab\/wallpaperdb\/(issues|pull)\/\d+$/.test(linked.url);
          const parsed = member.parse({ ...raw, content: local ? linked : null });
          members.set(parsed.id, parsed);
        }
      }
      if (members.size > 5000) throw new Error('Project synchronization exceeds supported bound');
      const next: State = {
        format: 1,
        revision: (previous?.revision ?? 0) + 1,
        projectId,
        checkpoint: startedAt,
        indexedAt: full ? startedAt : previous.indexedAt,
        members: [...members.values()],
        details: { ...previous?.details },
      };
      const pointers = new Map<string, z.infer<typeof member>>(
        next.members.flatMap((item) =>
          item.content ? [[`${item.content.__typename}/${item.content.number}`, item] as const] : []
        )
      );
      if (pointers.size !== next.members.filter((item) => item.content).length)
        throw new Error('Duplicate project content identity');
      for (const key of Object.keys(next.details)) if (!pointers.has(key)) delete next.details[key];
      return {
        members: next.members.flatMap((item) => (item.content ? [item.content] : [])),
        hydrate: async (
          kind: 'Issue' | 'PullRequest',
          numbers: readonly number[],
          fields: string,
          fresh = false
        ) => {
          const result = new Map<number, unknown>();
          const pending: number[] = [];
          for (const number of new Set(numbers)) {
            const key = `${kind}/${number}`;
            const pointer = pointers.get(key);
            const marker = pointer
              ? JSON.stringify([pointer.id, pointer.updatedAt, pointer.content?.updatedAt])
              : undefined;
            const cached = next.details[key];
            // GitHub markers have second precision. Verify an early capture again
            // after the marker settles so a second edit in that second is retained.
            const settledAt = pointer
              ? Math.max(
                  Date.parse(pointer.updatedAt),
                  Date.parse(pointer.content?.updatedAt ?? pointer.updatedAt)
                ) + timestampSettlingMs
              : Infinity;
            if (!fresh && marker && cached?.marker === marker && cached.fetchedAt >= settledAt)
              result.set(number, cached.value);
            else pending.push(number);
          }
          for (let offset = 0; offset < pending.length; offset += 20) {
            const batch = pending.slice(offset, offset + 20);
            const selection = batch
              .map(
                (number) =>
                  `${kind === 'Issue' ? 'i' : 'p'}${number}:${kind === 'Issue' ? 'issue' : 'pullRequest'}(number:${number}) { ${fields} }`
              )
              .join(' ');
            const raw = z
              .object({ data: z.object({ repository: z.record(z.unknown()) }) })
              .parse(
                await read(
                  [
                    'api',
                    'graphql',
                    '-f',
                    `query=query { repository(owner:"rafaeltab",name:"wallpaperdb") { ${selection} } }`,
                  ],
                  signal
                )
              );
            for (const number of batch) {
              const value = raw.data.repository[`${kind === 'Issue' ? 'i' : 'p'}${number}`];
              if (!value) throw new Error('Missing project content');
              result.set(number, value);
              const key = `${kind}/${number}`;
              const pointer = pointers.get(key);
              if (pointer && !fresh)
                next.details[key] = {
                  marker: JSON.stringify([
                    pointer.id,
                    pointer.updatedAt,
                    pointer.content?.updatedAt,
                  ]),
                  fetchedAt: startedAt,
                  value,
                };
            }
          }
          return result;
        },
        commit: () => {
          if (options.directory)
            stateConnection(options.directory, (db, namespace) =>
              db.transaction(
                (tx) => {
                  const existing = tx
                    .select()
                    .from(records)
                    .where(and(eq(records.namespace, namespace), eq(records.name, recordName)))
                    .get()?.value;
                  if (
                    (existing === undefined ? undefined : state.parse(existing).revision) !==
                    previous?.revision
                  )
                    throw new Error('Project synchronization publication conflict');
                  tx.insert(records)
                    .values({ namespace, name: recordName, value: next })
                    .onConflictDoUpdate({
                      target: [records.namespace, records.name],
                      set: { value: next },
                    })
                    .run();
                },
                { behavior: 'immediate' }
              )
            );
          else {
            if (memory?.revision !== previous?.revision)
              throw new Error('Project synchronization publication conflict');
            memory = next;
          }
        },
      };
    },
  };
}
