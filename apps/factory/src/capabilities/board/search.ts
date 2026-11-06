import type { IssueSearch, BoardFailure, BoardSnapshot } from './model.js';
import { failure, version } from './values.js';
/** Search is entirely local. Tokens expire when indexed issues/actions change. */
export function issueSearch(read: () => BoardSnapshot) {
  const pages = new Map<string, { generation: string; query: string; offset: number }>();
  return (query: string, limit: number, token?: string): IssueSearch | BoardFailure => {
    const snapshot = read(),
      normalized = query.trim().replace(/^#/, '').toLowerCase();
    const generation = version({
      issues: snapshot.entities.issues,
      actions: snapshot.entities.actions,
    });
    const page = token ? pages.get(token) : undefined;
    if (token && (!page || page.generation !== generation))
      return failure(
        'search-expired',
        'The search index changed or the page expired. Restart the search.'
      );
    if (page && page.query !== normalized)
      return failure('invalid-input', 'Search query does not match the page token.');
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
