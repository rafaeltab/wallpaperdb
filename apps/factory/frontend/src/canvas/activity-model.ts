import type { FactoryV2Snapshot } from '../../../src/http/index.js';
export type ActivityFacts = NonNullable<FactoryV2Snapshot['meta']['activity']>;
type Category = ActivityFacts['items'][number]['category'];
const categories: readonly { category: Category; name: string; noun?: string }[] = [
  { category: 'publishing', name: 'Publishing', noun: 'issue' },
  { category: 'reviewing', name: 'Reviewing', noun: 'issue' },
  { category: 'implementing', name: 'Implementing', noun: 'issue' },
  { category: 'restacking', name: 'Restacking', noun: 'PR' },
  { category: 'recovering', name: 'Recovering' },
  { category: 'planning', name: 'Planning' },
  { category: 'gathering-planning-context', name: 'Gathering planning context' },
  { category: 'checking-plan-freshness', name: 'Checking plan freshness' },
  { category: 'refreshing-github', name: 'Refreshing GitHub' },
  { category: 'refreshing-t3', name: 'Refreshing T3 information' },
  { category: 'waiting-for-ci', name: 'Waiting for CI', noun: 'issue' },
  { category: 'waiting-for-answers', name: 'Waiting for answers', noun: 'issue' },
];
export function activityView(facts: ActivityFacts | undefined, failures: number) {
  const groups = categories.map((definition) => {
    const items = facts?.items.filter((item) => item.category === definition.category) ?? [];
    const identity = (item: ActivityFacts['items'][number]) =>
      definition.noun === 'PR' ? (item.pullRequest ?? item.id) : (item.issue ?? item.id);
    const count = new Set(items.map(identity)).size;
    // Unknown starts may belong to the newest item. Never fabricate a group timestamp.
    const startedAt =
      !items.length || items.some((item) => item.startedAt === null)
        ? null
        : items.reduce<string | null>(
            (latest, item) =>
              latest === null || Date.parse(item.startedAt ?? '') > Date.parse(latest)
                ? item.startedAt
                : latest,
            null
          );
    return {
      ...definition,
      items,
      count,
      startedAt,
      metric: `${count} ${definition.noun ?? 'operation'}${count === 1 ? '' : 's'}`,
      unknown:
        !facts ||
        facts.coverage.some((c) => c.category === definition.category && c.state === 'unknown'),
    };
  });
  const selected = groups.find((group) => group.count > 0);
  const coverageIncomplete = !facts || groups.some((g) => g.unknown);
  const unknown = coverageIncomplete || !!facts?.uncertainty.length;
  const summary =
    failures >= 3
      ? 'Disconnected'
      : selected
        ? selected.category === 'recovering'
          ? 'Reconciling'
          : `${selected.name}${selected.noun ? ` ${selected.metric}` : ''}`
        : unknown
          ? 'Status unknown'
          : 'Idle';
  return { groups, selected, summary, unknown, coverageIncomplete };
}
export function activityDuration(start: string | null, now: number) {
  if (start === null) return '-s';
  const seconds = Math.max(0, Math.floor((now - Date.parse(start)) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
export function activityAge(start: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return `${Math.floor(seconds / 3600)} hours ${Math.floor(seconds / 60) % 60} minutes ${seconds % 60} seconds ago`;
}
