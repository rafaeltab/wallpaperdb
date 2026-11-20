import { expect, it } from 'vitest';
import { activityView, activityDuration } from '../src/canvas/activity-model';
import type { FactoryV2Snapshot } from '../../src/http/index.js';
type Facts = NonNullable<FactoryV2Snapshot['meta']['activity']>;
const facts: Facts = {
  observedAt: '2026-11-17T12:00:00Z',
  coverage: [],
  uncertainty: [],
  admissionReasons: [],
  items: [],
};
it('uses the fixed priority, distinct current associations and newest remaining start', () => {
  const items: Facts['items'] = [
    {
      id: 'a',
      category: 'implementing',
      lifecycle: 'current',
      issue: 1,
      pullRequest: null,
      startedAt: '2026-11-17T11:58:00Z',
      reason: 'Building',
    },
    {
      id: 'b',
      category: 'implementing',
      lifecycle: 'current',
      issue: 2,
      pullRequest: null,
      startedAt: '2026-11-17T11:59:00Z',
      reason: 'Building',
    },
    {
      id: 'c',
      category: 'refreshing-github',
      lifecycle: 'current',
      issue: null,
      pullRequest: null,
      startedAt: null,
      reason: 'Refreshing',
    },
  ];
  expect(activityView({ ...facts, items }, 0).summary).toBe('Implementing 2 issues');
  expect(activityView({ ...facts, items }, 0).selected?.startedAt).toBe('2026-11-17T11:59:00Z');
  expect(
    activityView({ ...facts, items: items.filter((i) => i.id !== 'b') }, 0).selected?.startedAt
  ).toBe('2026-11-17T11:58:00Z');
  expect(
    activityView(
      { ...facts, items: [...items, { ...items[0], id: 'd', category: 'publishing' }] },
      0
    ).summary
  ).toBe('Publishing 1 issue');
  expect(activityView(facts, 0).groups.map((g) => g.name)).toEqual([
    'Publishing',
    'Reviewing',
    'Implementing',
    'Restacking',
    'Recovering',
    'Planning',
    'Gathering planning context',
    'Checking plan freshness',
    'Refreshing GitHub',
    'Refreshing T3 information',
    'Waiting for CI',
    'Waiting for answers',
  ]);
});
it('distinguishes incomplete evidence, idle and disconnected, preserving known activity', () => {
  expect(activityView(undefined, 0).summary).toBe('Status unknown');
  expect(activityView(facts, 0).summary).toBe('Idle');
  expect(activityView({ ...facts, uncertainty: ['Unknown execution'] }, 0).summary).toBe(
    'Status unknown'
  );
  expect(activityView(facts, 3).summary).toBe('Disconnected');
  expect(activityDuration(null, 0)).toBe('-s');
  expect(activityDuration('2026-11-17T11:58:00Z', Date.parse('2026-11-17T12:00:01Z'))).toBe(
    '2m 1s'
  );
});

it('selects each category ahead of every lower priority category', () => {
  const order = [
    'publishing',
    'reviewing',
    'implementing',
    'restacking',
    'recovering',
    'planning',
    'gathering-planning-context',
    'checking-plan-freshness',
    'refreshing-github',
    'refreshing-t3',
    'waiting-for-ci',
    'waiting-for-answers',
  ] as const;
  const labels = [
    'Publishing 1 issue',
    'Reviewing 1 issue',
    'Implementing 1 issue',
    'Restacking 1 PR',
    'Reconciling',
    'Planning',
    'Gathering planning context',
    'Checking plan freshness',
    'Refreshing GitHub',
    'Refreshing T3 information',
    'Waiting for CI 1 issue',
    'Waiting for answers 1 issue',
  ];
  order.forEach((_category, index) => {
    const items = order.slice(index).map((category) => ({
      id: category,
      category,
      lifecycle: 'current' as const,
      issue: 1,
      pullRequest: 2,
      startedAt: null,
      reason: 'Current managed work',
    }));
    expect(activityView({ ...facts, items }, 0).summary).toBe(labels[index]);
  });
});

it('keeps gathering above freshness and times the newest current collection locally', () => {
  const item = {
    id: 'gather',
    category: 'gathering-planning-context',
    lifecycle: 'current',
    issue: null,
    pullRequest: null,
    startedAt: '2026-11-17T11:59:00Z',
    reason: 'Collecting',
  } as const;
  const view = activityView(
    { ...facts, items: [item, { ...item, id: 'fresh', category: 'checking-plan-freshness' }] },
    0
  );
  expect(view.summary).toBe('Gathering planning context');
  expect(view.selected?.count).toBe(1);
  expect(
    activityDuration(view.selected?.startedAt ?? null, Date.parse('2026-11-17T12:00:01Z'))
  ).toBe('1m 1s');
  expect(
    activityView({ ...facts, items: [item, { ...item, id: 'plan', category: 'planning' }] }, 0)
      .summary
  ).toBe('Planning');
});

it('counts CI waits by issue and recalculates the newest current managed wait', () => {
  const wait = {
    id: 'one',
    category: 'waiting-for-ci' as const,
    lifecycle: 'current' as const,
    issue: 1,
    pullRequest: 10,
    startedAt: '2026-11-17T11:58:00Z',
    reason: 'Managed CI',
  };
  const items = [
    wait,
    { ...wait, id: 'duplicate', pullRequest: 11 },
    { ...wait, id: 'two', issue: 2, startedAt: '2026-11-17T11:59:00Z' },
  ];
  expect(activityView({ ...facts, items }, 0).summary).toBe('Waiting for CI 2 issues');
  expect(activityView({ ...facts, items }, 0).selected?.startedAt).toBe('2026-11-17T11:59:00Z');
  expect(activityView({ ...facts, items: items.slice(0, 2) }, 0).selected?.startedAt).toBe(
    '2026-11-17T11:58:00Z'
  );
});

it('counts distinct answer-wait issues with newest-current timing and yields to other activities', () => {
  const wait = {
    id: 'q1',
    category: 'waiting-for-answers' as const,
    lifecycle: 'current' as const,
    issue: 1,
    pullRequest: null,
    startedAt: '2026-11-17T11:58:00Z',
    reason: 'Choose',
  };
  const items = [
    wait,
    { ...wait, id: 'recovery', startedAt: '2026-11-17T11:59:00Z' },
    { ...wait, id: 'q2', issue: 2 },
  ];
  const view = activityView({ ...facts, items }, 0);
  expect(view.summary).toBe('Waiting for answers 2 issues');
  expect(view.groups.at(-1)?.startedAt).toBe('2026-11-17T11:59:00Z');
  expect(
    activityDuration(view.selected?.startedAt ?? null, Date.parse('2026-11-17T12:00:05Z'))
  ).toBe('1m 5s');
  expect(activityView({ ...facts, items: [wait] }, 0).selected?.startedAt).toBe(
    '2026-11-17T11:58:00Z'
  );
  expect(
    activityView(
      {
        ...facts,
        items: [...items, { ...wait, id: 'ci', category: 'waiting-for-ci', pullRequest: 2 }],
      },
      0
    ).summary
  ).toBe('Waiting for CI 1 issue');
});

it('counts restacking PRs and times the newest remaining PR between implementing and recovering', () => {
  const restack = {
    id: 'one',
    category: 'restacking' as const,
    lifecycle: 'current' as const,
    issue: 1,
    pullRequest: 101,
    startedAt: '2026-11-17T11:58:00Z',
    reason: 'Restacking',
  };
  const items = [
    restack,
    { ...restack, id: 'duplicate', issue: 2 },
    { ...restack, id: 'two', pullRequest: 102, startedAt: '2026-11-17T11:59:00Z' },
    { ...restack, id: 'recover', category: 'recovering' as const },
  ];
  const view = activityView({ ...facts, items }, 0);
  expect(view.summary).toBe('Restacking 2 PRs');
  expect(
    activityDuration(view.selected?.startedAt ?? null, Date.parse('2026-11-17T12:00:01Z'))
  ).toBe('1m 1s');
  expect(activityView({ ...facts, items: [restack] }, 0).selected?.startedAt).toBe(
    '2026-11-17T11:58:00Z'
  );
  expect(
    activityView(
      { ...facts, items: [...items, { ...restack, id: 'impl', category: 'implementing' }] },
      0
    ).summary
  ).toBe('Implementing 1 issue');
  expect(
    activityView({ ...facts, items: [{ ...restack, startedAt: null }] }, 0).selected?.startedAt
  ).toBeNull();
});
