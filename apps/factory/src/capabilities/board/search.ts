import type { FactoryV2Snapshot, FactoryV2IssueSearch, FactoryV2Problem } from './model.js';
import { version, problem } from './values.js';
/** Search is entirely local. Tokens expire when indexed issues/actions change. */
export function issueSearch(read: () => FactoryV2Snapshot) {
  const pages = new Map<string, { generation: string; query: string; offset: number }>();
  return (
    query: string,
    limit: number,
    token?: string
  ): FactoryV2IssueSearch | FactoryV2Problem => {
    const snapshot = read(),
      normalized = query.trim().replace(/^#/, '').toLowerCase();
    const generation = version({
      issues: snapshot.entities.issues,
      actions: snapshot.entities.actions,
    });
    const page = token ? pages.get(token) : undefined;
    if (token && (!page || page.generation !== generation))
      return problem(
        409,
        'stale-action',
        'The search index changed or the page expired. Restart the search.'
      );
    if (page && page.query !== normalized)
      return problem(400, 'invalid-request', 'Search query does not match the page token.');
    const matches = Object.values(snapshot.entities.issues)
      .filter((i) =>
        `${i.number} ${i.metadata.state === 'known' ? i.metadata.value.title : ''}`
          .toLowerCase()
          .includes(normalized)
      )
      .sort((a, b) => a.number - b.number);
    const offset = page?.offset ?? 0;
    const selected = matches.slice(offset, offset + limit);
    let nextPageToken: string | null = null;
    if (offset + limit < matches.length) {
      nextPageToken = version({ generation, query: normalized, offset: offset + limit });
      pages.set(nextPageToken, { generation, query: normalized, offset: offset + limit });
      if (pages.size > 512) {
        const oldest = pages.keys().next().value;
        if (oldest) pages.delete(oldest);
      }
    }
    return {
      apiVersion: 2,
      query,
      nextPageToken,
      coverage: snapshot.meta.coverage,
      sources: snapshot.entities.sources,
      hits: selected.map((issue) => ({
        issue,
        startAction: snapshot.entities.actions[`action:start/${issue.id}`],
      })),
      users: snapshot.entities.users,
      labels: snapshot.entities.labels,
      repositories: snapshot.entities.repositories,
    };
  };
}
