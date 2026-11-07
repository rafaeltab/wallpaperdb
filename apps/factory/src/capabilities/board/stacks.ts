import type { SourceId, Tables } from './model.js';
import { entity, known, pullId } from './values.js';
export function stacks(
  tables: Tables,
  edges: readonly { base: number; tip: number }[],
  observedAt: string | null
) {
  const relationships = { ...tables.relationships },
    result: Tables['stacks'] = {};
  const diagnostics: import('./model.js').Reason[] = [];
  if (!observedAt) return { relationships, stacks: result, diagnostics };
  const next = new Map<number, number[]>(),
    previous = new Map<number, number[]>();
  for (const edge of edges) {
    if (!tables.pullRequests[pullId(edge.base)] || !tables.pullRequests[pullId(edge.tip)]) continue;
    next.set(edge.base, [...new Set([...(next.get(edge.base) ?? []), edge.tip])]);
    previous.set(edge.tip, [...new Set([...(previous.get(edge.tip) ?? []), edge.base])]);
    const id = `relationship:pr-base/${edge.base}/${edge.tip}` as const;
    Object.assign(relationships, {
      [id]: entity({
        id,
        kind: 'pr-base',
        basePullRequestId: pullId(edge.base),
        tipPullRequestId: pullId(edge.tip),
        evidence: known('git-ancestry', 'source:github' satisfies SourceId, observedAt),
      }),
    });
  }
  const all = [...new Set(edges.flatMap((e) => [e.base, e.tip]))].filter(
    (n) => tables.pullRequests[pullId(n)]
  );
  const visited = new Set<number>();
  for (const root of all.filter((n) => {
    const parents = previous.get(n) ?? [];
    return parents.length !== 1 || (next.get(parents[0]) ?? []).length !== 1;
  })) {
    if (visited.has(root)) continue;
    const chain: number[] = [];
    let current = root;
    while (!visited.has(current)) {
      chain.push(current);
      visited.add(current);
      const children = next.get(current) ?? [];
      if (children.length !== 1 || (previous.get(children[0]) ?? []).length !== 1) break;
      current = children[0];
    }
    if (chain.length < 2) continue;
    const base = tables.pullRequests[pullId(root)].metadata;
    if (base.state !== 'known') continue;
    const id = `stack:${root}` as const;
    Object.assign(result, {
      [id]: entity({
        id,
        pullRequestIdsBaseToTip: chain.map(pullId),
        base: { ref: base.value.baseRef, oid: base.value.comparison.baseOid },
        evidence: known('git-ancestry', 'source:github', observedAt),
      }),
    });
  }
  if (all.some((n) => !visited.has(n)))
    diagnostics.push({
      code: 'cyclic-stack',
      message: 'Cyclic or ambiguous stack evidence is shown as independent PRs.',
    });
  return { relationships, stacks: result, diagnostics };
}
