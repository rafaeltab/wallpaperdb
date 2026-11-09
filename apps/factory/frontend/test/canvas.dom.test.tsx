import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { FactoryApp } from '../src/canvas/app';
import { FactoryClient } from '../src/canvas/client';
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
async function sample() {
  const app = fakeV2Server({ epoch: 'dom' });
  try {
    return (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
  } finally {
    await app.close();
  }
}
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  HTMLDialogElement.prototype.show = function () {
    this.setAttribute('open', '');
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('retains last-known items when refresh fails and disables command controls', async () => {
  const board = await sample();
  let offline = false,
    posts = 0;
  const client = new FactoryClient(async (_path, init) => {
    if (init?.method === 'POST') posts++;
    if (offline) throw new TypeError('offline');
    return json(board);
  });
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  await screen.findByText('Implement the command centre');
  offline = true;
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
  });
  await screen.findByText(/Showing last-known board/);
  expect(screen.getByText('Implement the command centre')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Factory settings' }));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply controls' }).disabled).toBe(
    true
  );
  expect(posts).toBe(0);
});
it('preserves a dirty control draft and blocks saving when the observed control version changes', async () => {
  let board = await sample();
  const client = new FactoryClient(async () => json(board));
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  await screen.findByText('Implement the command centre');
  await user.click(screen.getByRole('button', { name: 'Factory settings' }));
  const input = screen.getByLabelText<HTMLInputElement>('Concurrency', { exact: true });
  await user.clear(input);
  await user.type(input, '7');
  board = {
    ...board,
    meta: {
      ...board.meta,
      factory: {
        ...board.meta.factory,
        version: 'new-controls',
        concurrency: { limit: { kind: 'limited', maximum: 9 }, occupied: 2 },
      },
    },
  };
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
  });
  await screen.findByText(/Factory controls changed while editing/);
  expect(input.value).toBe('7');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply controls' }).disabled).toBe(
    true
  );
});
it('discards a board response owned by a page lifetime before restoration', async () => {
  const board = await sample();
  let reads = 0,
    late: (value: Response) => void = () => {
      throw new Error('No pending read');
    };
  const client = new FactoryClient(async () => {
    if (++reads === 2)
      return new Promise<Response>((resolve) => {
        late = resolve;
      });
    return json(board);
  });
  vi.useFakeTimers();
  await act(async () => {
    render(<FactoryApp client={client} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(reads).toBe(2);
  act(() => window.dispatchEvent(new Event('pagehide')));
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
  });
  expect(reads).toBe(3);
  const replaced = {
    ...board,
    meta: { ...board.meta, diagnostics: [{ code: 'old', message: 'Abandoned response' }] },
  };
  await act(async () => {
    late(json(replaced));
  });
  expect(screen.queryByText('Abandoned response')).toBeNull();
  expect(screen.getByText('Implement the command centre')).toBeTruthy();
});
it('distinguishes complete empty data from unavailable coverage', async () => {
  let board = await sample();
  board = { ...board, entities: { ...board.entities, items: {} } };
  const client = new FactoryClient(async () => json(board));
  render(<FactoryApp client={client} />);
  await screen.findByText('No work items.');
  board = {
    ...board,
    meta: {
      ...board.meta,
      coverage: {
        state: 'unavailable',
        reasons: [{ code: 'offline', message: 'GitHub unavailable' }],
        unresolvedIssueIds: [],
      },
    },
  };
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
  });
  await screen.findByText('Work items unavailable. Check source coverage.');
  expect(
    screen.getByRole('button', { name: 'Highlight 0 items needing human attention' })
  ).toBeTruthy();
});
it.each(['network', '503', '500'] as const)(
  'keeps uncertain commands recoverable after %s without creating a new UUID',
  async (failure) => {
    const board = await sample(),
      bodies: string[] = [];
    const client = new FactoryClient(async (path, init) => {
      if (init?.method === 'POST') {
        bodies.push(String(init.body));
        if (bodies.length === 1) {
          if (failure === 'network') throw new TypeError('Connection lost');
          return new Response(
            JSON.stringify({
              detail: 'Storage unavailable',
              retry: failure === '500' ? 'never' : 'later',
            }),
            {
              status: Number(failure),
            }
          );
        }
        return json({
          commandId: JSON.parse(bodies[0]).commandId,
          state: 'succeeded',
          reasons: [],
        });
      }
      if (String(path).includes('/commands/'))
        return new Response(JSON.stringify({ detail: 'Receipt not found' }), { status: 404 });
      return json(board);
    });
    const user = userEvent.setup();
    render(<FactoryApp client={client} />);
    await screen.findByText('Implement the command centre');
    await user.click(screen.getByRole('button', { name: 'Factory settings' }));
    await user.click(screen.getByRole('button', { name: 'Apply controls' }));
    const dialog = screen.getByRole('dialog', { name: 'Factory controls' });
    expect(dialog.textContent).toContain('Command uncertain');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply controls' }).disabled).toBe(
      true
    );
    await user.click(screen.getByRole('button', { name: 'Observe command receipt' }));
    await screen.findByText('Receipt not found');
    expect(bodies).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Retry same command' }));
    await screen.findByText('Command succeeded');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  }
);

it('allows a fresh command after a definitive stale-action rejection', async () => {
  const board = await sample(),
    bodies: string[] = [];
  const client = new FactoryClient(async (_path, init) => {
    if (init?.method !== 'POST') return json(board);
    bodies.push(String(init.body));
    if (bodies.length === 1)
      return new Response(JSON.stringify({ detail: 'Action changed', retry: 'refresh' }), {
        status: 412,
      });
    return json({ commandId: JSON.parse(bodies[1]).commandId, state: 'succeeded', reasons: [] });
  });
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  await screen.findByText('Implement the command centre');
  await user.click(screen.getByRole('button', { name: 'Factory settings' }));
  await user.click(screen.getByRole('button', { name: 'Apply controls' }));
  await screen.findByText('Action changed');
  expect(screen.queryByRole('button', { name: 'Retry same command' })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply controls' }).disabled).toBe(
    false
  );
  await user.click(screen.getByRole('button', { name: 'Apply controls' }));
  await screen.findByText('Command succeeded');
  expect(bodies).toHaveLength(2);
  expect(JSON.parse(bodies[1]).commandId).not.toBe(JSON.parse(bodies[0]).commandId);
});

it('starts a fresh session when another issue is opened in the floating Start panel', async () => {
  const seed = await sample();
  const first = seed.entities.issues['issue:1001'];
  const firstItem = seed.entities.items['item:1001'];
  const firstAction = seed.entities.actions['action:start-1001'];
  if (first.metadata.state !== 'known') throw new Error('Expected known first issue');
  const second = {
    ...first,
    id: 'issue:9999',
    number: 9999,
    metadata: {
      ...first.metadata,
      value: { ...first.metadata.value, title: 'Another ready issue' },
    },
  } satisfies typeof first;
  const secondAction = {
    ...firstAction,
    id: 'action:start-9999',
    targetId: second.id,
  } satisfies typeof firstAction;
  const board = {
    ...seed,
    entities: {
      ...seed.entities,
      issues: { ...seed.entities.issues, [second.id]: second },
      actions: { ...seed.entities.actions, [secondAction.id]: secondAction },
      items: {
        ...seed.entities.items,
        'item:9999': {
          ...firstItem,
          id: 'item:9999',
          subject: { kind: 'issue', issueId: second.id },
          actionIds: [secondAction.id],
        },
      },
    },
  } satisfies FactoryV2Snapshot;
  const commands: string[] = [];
  const client = new FactoryClient(async (path, init) => {
    if (init?.method === 'POST') {
      commands.push(String(init.body));
      return json({
        commandId: JSON.parse(String(init.body)).commandId,
        state: 'succeeded',
        reasons: [],
      });
    }
    const url = new URL(String(path), 'http://controlled.invalid');
    if (url.pathname.endsWith('/issues/search')) {
      const query = url.searchParams.get('q') ?? '';
      return json({
        apiVersion: 2,
        query,
        coverage: board.meta.coverage,
        nextPageToken: null,
        sources: board.entities.sources,
        users: board.entities.users,
        labels: board.entities.labels,
        repositories: board.entities.repositories,
        hits:
          query === '9999'
            ? [{ issue: second, startAction: secondAction }]
            : [{ issue: first, startAction: firstAction }],
      } satisfies import('../../src/http/index.js').FactoryV2IssueSearch);
    }
    return json(board);
  });
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  await user.click(
    await screen.findByRole('group', { name: 'Select Add a searchable issue list' })
  );
  await user.click(screen.getByRole('button', { name: 'Start issue' }));
  await user.click(
    await screen.findByRole('button', { name: '#1001 Add a searchable issue list' })
  );
  await user.type(screen.getByLabelText('Execution context'), 'Only for the first issue');
  await user.click(screen.getByRole('button', { name: 'Start issue' }));
  expect(screen.getByLabelText<HTMLTextAreaElement>('Execution context').value).toBe(
    'Only for the first issue'
  );
  await user.click(screen.getByRole('group', { name: 'Select Another ready issue' }));
  await user.click(screen.getByRole('button', { name: 'Start issue' }));
  expect(screen.getByLabelText<HTMLInputElement>('Search issues').value).toBe('9999');
  expect(screen.getByLabelText<HTMLTextAreaElement>('Execution context').value).toBe('');
  expect(screen.queryByRole('button', { name: 'Start selected issue' })).toBeNull();
  await user.click(await screen.findByRole('button', { name: '#9999 Another ready issue' }));
  await user.type(screen.getByLabelText('Execution context'), 'Only for the second issue');
  await user.click(screen.getByRole('button', { name: 'Start selected issue' }));
  await screen.findByText('Command succeeded');
  expect(commands).toHaveLength(1);
  expect(JSON.parse(commands[0])).toMatchObject({
    actionId: 'action:start-9999',
    payload: { context: 'Only for the second issue' },
  });
});

it('keeps failed checks and detail check names visible without URLs', async () => {
  let board = await sample();
  const pr = board.entities.pullRequests['pr:2003'];
  if (pr.checks.state !== 'known') throw new Error('Expected known sample checks');
  board = {
    ...board,
    entities: {
      ...board.entities,
      pullRequests: {
        ...board.entities.pullRequests,
        [pr.id]: {
          ...pr,
          checks: {
            ...pr.checks,
            value: {
              ...pr.checks.value,
              state: 'failed',
              groups: [{ ...pr.checks.value.groups[0], state: 'failed', url: null }],
            },
          },
        },
      },
    },
  };
  const client = new FactoryClient(async (path) =>
    String(path).includes('/items/')
      ? json({
          apiVersion: 2,
          itemId: 'item:1003',
          itemVersion: '1',
          observedAt: board.committedAt,
          questions: [],
          checkRuns: {
            state: 'known',
            sourceId: 'source:github',
            observedAt: board.committedAt,
            value: [
              {
                id: 'check-no-url',
                groupId: 'ci',
                name: 'Check without a provider link',
                url: null,
                comparison: { headOid: 'previous-head', baseOid: null, baseRef: null },
                state: 'failed',
                startedAt: null,
                completedAt: null,
              },
            ],
          },
        })
      : json(board)
  );
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  const checks = await screen.findByLabelText('Checks: failed. Current comparison');
  expect(checks.querySelector('.cc-check.failed svg')).toBeTruthy();
  await user.click(screen.getByRole('group', { name: 'Select Expose observation metadata' }));
  await user.click(screen.getByRole('button', { name: 'Details' }));
  await screen.findByText('Check without a provider link');
});

it.each([
  { head: 'current', previousBase: false, qualifier: 'Current comparison', approved: true },
  { head: 'previous', previousBase: false, qualifier: 'Previous comparison', approved: false },
  { head: 'unknown', previousBase: false, qualifier: 'Reviewed head unknown', approved: false },
  { head: 'current', previousBase: true, qualifier: 'Previous comparison', approved: false },
])('qualifies an approval for $head head and previous base $previousBase', async (scenario) => {
  const seed = await sample(),
    pr = seed.entities.pullRequests['pr:2003'];
  if (pr.metadata.state !== 'known' || pr.reviews.state !== 'known')
    throw new Error('Expected current PR metadata and reviews');
  const comparison = pr.metadata.value.comparison;
  const board: FactoryV2Snapshot = {
    ...seed,
    entities: {
      ...seed.entities,
      pullRequests: {
        ...seed.entities.pullRequests,
        [pr.id]: {
          ...pr,
          reviews: {
            ...pr.reviews,
            value: {
              ...pr.reviews.value,
              comparison: scenario.previousBase
                ? { ...comparison, baseOid: 'previous-base' }
                : comparison,
              reviewers: [
                {
                  userId: 'user:demo',
                  state: 'approved',
                  submittedAt: null,
                  reviewedHeadOid:
                    scenario.head === 'unknown'
                      ? null
                      : scenario.head === 'previous'
                        ? 'previous-head'
                        : comparison.headOid,
                },
              ],
            },
          },
        },
      },
    },
  };
  render(<FactoryApp client={new FactoryClient(async () => json(board))} />);
  const reviewer = await screen.findByLabelText(`demo-reviewer · approved · ${scenario.qualifier}`);
  expect(!!reviewer.querySelector('b.approved')).toBe(scenario.approved);
});

it('retains supported browser links when native T3 links are unavailable', async () => {
  const board = await sample(),
    client = new FactoryClient(async () => json(board));
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  await screen.findByText('Implement the command centre');
  const initial = screen.getAllByRole('link', { name: /T3 ·/ }).map((a) => a.getAttribute('href'));
  await user.click(screen.getByRole('button', { name: 'Factory settings' }));
  await user.selectOptions(screen.getByLabelText('T3 link destination'), 'native');
  await user.click(screen.getByRole('button', { name: 'Close Factory controls' }));
  const fallback = screen.getAllByRole('link', { name: /T3 ·/ }).map((a) => a.getAttribute('href'));
  expect(fallback).toEqual(initial);
});

it('rejects zero controls before POST while preserving the unlimited option', async () => {
  const board = await sample(),
    posts: string[] = [];
  const client = new FactoryClient(async (_path, init) => {
    if (init?.method === 'POST') {
      posts.push(String(init.body));
      return json({ commandId: 'receipt', state: 'succeeded', reasons: [] });
    }
    return json(board);
  });
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  await screen.findByText('Implement the command centre');
  await user.click(screen.getByRole('button', { name: 'Factory settings' }));
  const input = screen.getByLabelText('Concurrency');
  await user.clear(input);
  await user.type(input, '0');
  await user.click(screen.getByRole('button', { name: 'Apply controls' }));
  expect(posts).toHaveLength(0);
  await screen.findByText(/positive whole numbers/);
  await user.clear(input);
  await user.click(screen.getByRole('button', { name: 'Apply controls' }));
  expect(JSON.parse(posts[0]).payload.concurrency).toEqual({ kind: 'unlimited' });
});

it('pauses hidden-tab polling and immediately refreshes when visible again', async () => {
  const board = await sample();
  let reads = 0,
    hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const client = new FactoryClient(async () => {
    reads++;
    return json(board);
  });
  vi.useFakeTimers();
  await act(async () => {
    render(<FactoryApp client={client} />);
  });
  expect(reads).toBe(1);
  act(() => {
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(reads).toBe(1);
  await act(async () => {
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(reads).toBe(2);
});

async function multiJobBoard(kind: 'resume' | 'cancel'): Promise<FactoryV2Snapshot> {
  const board = await sample(),
    item = board.entities.items['item:1006'];
  if (item.subject.kind !== 'pull-request') throw new Error('Expected PR item');
  const first = board.entities.actions[`action:${kind}-1005`];
  return {
    ...board,
    entities: {
      ...board.entities,
      jobs: {
        ...board.entities.jobs,
        'job:second': {
          ...board.entities.jobs['job:1005'],
          id: 'job:second',
          issueId: 'issue:1006',
          pullRequestId: 'pr:2006',
          progress: 'Second worker',
        },
      },
      actions: {
        ...board.entities.actions,
        [`action:${kind}-second`]: {
          ...first,
          id: `action:${kind}-second`,
          targetId: 'job:second',
          availability: { state: 'available', precondition: 'second-original', validUntil: null },
        },
      },
      items: {
        ...board.entities.items,
        [item.id]: {
          ...item,
          subject: { ...item.subject, issueIds: ['issue:1005', 'issue:1006'] },
          jobIds: ['job:1005', 'job:second'],
          actionIds: [first.id, `action:${kind}-second`],
        },
      },
    },
  };
}
it('submits the exact clicked resume action on a multi-job PR', async () => {
  const board = await multiJobBoard('resume'),
    posts: string[] = [];
  const client = new FactoryClient(async (_path, init) => {
    if (init?.method === 'POST') {
      posts.push(String(init.body));
      return json({ commandId: 'receipt', state: 'succeeded', reasons: [] });
    }
    return json(board);
  });
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  await user.click(await screen.findByRole('group', { name: 'Select Recover conflicts' }));
  await user.click(screen.getAllByRole('button', { name: /^Resume job/ })[1]);
  expect(JSON.parse(posts[0])).toMatchObject({
    actionId: 'action:resume-second',
    precondition: 'second-original',
  });
});
it('preserves the chosen cancel action and precondition while confirmation is open', async () => {
  let board = await multiJobBoard('cancel');
  const posts: string[] = [];
  const client = new FactoryClient(async (_path, init) => {
    if (init?.method === 'POST') {
      posts.push(String(init.body));
      return json({ commandId: 'receipt', state: 'succeeded', reasons: [] });
    }
    return json(board);
  });
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  await user.click(await screen.findByRole('group', { name: 'Select Recover conflicts' }));
  await user.click(screen.getAllByRole('button', { name: /^Cancel job/ })[1]);
  const item = board.entities.items['item:1006'];
  board = {
    ...board,
    entities: {
      ...board.entities,
      items: {
        ...board.entities.items,
        [item.id]: { ...item, version: 'new', actionIds: ['action:cancel-1005'] },
      },
    },
  };
  act(() => window.dispatchEvent(new Event('pagehide')));
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
  });
  await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  expect(JSON.parse(posts[0])).toMatchObject({
    actionId: 'action:cancel-second',
    precondition: 'second-original',
  });
});
it('shows both relationship directions initially and restores both when the active filter is clicked again', async () => {
  let board = await sample();
  const edge = board.entities.relationships['relationship:blocker'];
  if (edge.kind !== 'prerequisite') throw new Error('Expected prerequisite');
  board = {
    ...board,
    entities: {
      ...board.entities,
      relationships: {
        ...board.entities.relationships,
        'relationship:middle': {
          ...edge,
          id: 'relationship:middle',
          prerequisiteIssueId: 'issue:1003',
          dependantIssueId: 'issue:1002',
        },
      },
    },
  };
  const user = userEvent.setup();
  render(<FactoryApp client={new FactoryClient(async () => json(board))} />);
  await user.click(
    await screen.findByRole('group', { name: 'Select Implement the command centre' })
  );
  const filter = screen.getByRole('button', { name: 'Highlight prerequisites' });
  expect(filter.textContent).toContain('1 prerequisites');
  expect(filter.getAttribute('aria-pressed')).toBe('false');
  expect(document.querySelectorAll('.cc-item.cc-selected,.cc-item.cc-related')).toHaveLength(3);
  await user.click(filter);
  expect(filter.getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelectorAll('.cc-item.cc-selected,.cc-item.cc-related')).toHaveLength(2);
  await user.click(filter);
  expect(filter.getAttribute('aria-pressed')).toBe('false');
  expect(document.querySelectorAll('.cc-item.cc-selected,.cc-item.cc-related')).toHaveLength(3);
});
it('reveals collapsed items when attention highlighting is enabled', async () => {
  const board = await sample(),
    user = userEvent.setup();
  render(<FactoryApp client={new FactoryClient(async () => json(board))} />);
  await screen.findByText('Implement the command centre');
  const collapse = screen.getAllByRole('button', { name: /^Collapse all/ });
  await user.click(collapse[1]);
  await user.click(collapse[2]);
  expect(screen.queryByRole('group', { name: 'Select Reconcile a paused worker' })).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Highlight 2 items needing human attention' })
  );
  await screen.findByRole('group', { name: 'Select Reconcile a paused worker' });
  expect(document.querySelectorAll('.cc-item.cc-selected,.cc-item.cc-related')).toHaveLength(2);
});
it.each([
  { preferNative: false, web: null },
  { preferNative: true, web: 'https://example.invalid/planner' },
])(
  'keeps the planner thread accessible with native preference $preferNative and web URL $web',
  async ({ preferNative, web }) => {
    let board = await sample();
    const thread = board.entities.threads['thread:1002'];
    if (thread.metadata.state !== 'known') throw new Error('Expected thread metadata');
    const planner = {
      ...thread,
      metadata: {
        ...thread.metadata,
        value: { ...thread.metadata.value, webUrl: web, nativeUrl: 't3code://threads/env/planner' },
      },
    };
    const attempt = {
      id: 'plan:links',
      version: '1',
      startedAt: board.committedAt,
      deadline: board.committedAt,
      finishedAt: board.committedAt,
      phase: 'succeeded',
      progress: 'Advisory only',
      threadId: thread.id,
      basis: {
        boardCursor: board.cursor,
        inputVersion: '1',
        controlVersion: board.meta.factory.version,
      },
      applicability: 'current',
      result: { selected: [], deferred: [], rejected: [] },
    } satisfies import('../../src/http/index.js').FactoryV2PlanDetails['attempt'];
    board = {
      ...board,
      meta: { ...board.meta, currentPlanId: attempt.id },
      entities: { ...board.entities, plans: { [attempt.id]: attempt } },
    };
    const details = {
      apiVersion: 2,
      attempt,
      entities: {
        repositories: board.entities.repositories,
        issues: board.entities.issues,
        labels: board.entities.labels,
        users: board.entities.users,
        sources: board.entities.sources,
        threads: { [planner.id]: planner },
      },
    };
    const client = new FactoryClient(async (path) =>
      json(String(path).includes('/plans/') ? details : board)
    );
    const user = userEvent.setup();
    render(<FactoryApp client={client} />);
    await screen.findByText('Implement the command centre');
    if (preferNative) {
      await user.click(screen.getByRole('button', { name: 'Factory settings' }));
      await user.selectOptions(screen.getByLabelText('T3 link destination'), 'native');
      await user.click(screen.getByRole('button', { name: 'Close Factory controls' }));
    }
    await user.click(screen.getByRole('button', { name: '◇ Preview plan' }));
    const link = await screen.findByRole('link', { name: /Planner in T3/ });
    expect(link.getAttribute('href')).toBe('t3code://threads/env/planner');
  }
);

it('refreshes an open plan when the same attempt completes and its applicability changes', async () => {
  let board = await sample();
  let attempt: import('../../src/http/index.js').FactoryV2PlanDetails['attempt'] = {
    id: 'plan:progress',
    version: '1',
    startedAt: board.committedAt,
    deadline: board.committedAt,
    finishedAt: null,
    phase: 'discovery',
    progress: 'Gathering current issues',
    threadId: null,
    basis: {
      boardCursor: board.cursor,
      inputVersion: '1',
      controlVersion: board.meta.factory.version,
    },
    applicability: 'unknown',
    result: null,
  };
  const publish = () => {
    board = {
      ...board,
      meta: { ...board.meta, currentPlanId: attempt.id },
      entities: { ...board.entities, plans: { [attempt.id]: attempt } },
    };
  };
  publish();
  let reads = 0;
  const client = new FactoryClient(async (path) => {
    if (!String(path).includes('/plans/')) return json(board);
    reads++;
    return json({ apiVersion: 2, attempt, entities: board.entities });
  });
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  await screen.findByText('Implement the command centre');
  await user.click(screen.getByRole('button', { name: '◇ Preview plan' }));
  await screen.findByText('Gathering current issues');
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(reads).toBe(1);

  attempt = {
    ...attempt,
    version: '2',
    phase: 'succeeded',
    progress: 'Planning completed',
    finishedAt: board.committedAt,
    applicability: 'current',
    result: { selected: [], rejected: [], deferred: [] },
  };
  publish();
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  await screen.findByText('Planning completed');
  expect(screen.getByText('Proposed work')).toBeTruthy();
  expect(screen.getByText('Applicability: current')).toBeTruthy();
  expect(reads).toBe(2);

  attempt = { ...attempt, version: '3', applicability: 'stale' };
  publish();
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  await screen.findByText('Applicability: stale');
  expect(reads).toBe(3);
});

it('dismisses an open labels tooltip when its work item disappears from a fresh snapshot', async () => {
  let board = await sample();
  const issue = board.entities.issues['issue:1002'];
  if (issue.metadata.state !== 'known') throw new Error('Expected issue metadata');
  const label = board.entities.labels['label:infrastructure'];
  board = {
    ...board,
    entities: {
      ...board.entities,
      issues: {
        ...board.entities.issues,
        [issue.id]: {
          ...issue,
          metadata: {
            ...issue.metadata,
            value: {
              ...issue.metadata.value,
              labelIds: ['label:infrastructure', 'label:second', 'label:third'],
            },
          },
        },
      },
      labels: {
        ...board.entities.labels,
        'label:second': { ...label, id: 'label:second', name: 'Second label' },
        'label:third': { ...label, id: 'label:third', name: 'Third label' },
      },
    },
  };
  const user = userEvent.setup();
  render(<FactoryApp client={new FactoryClient(async () => json(board))} />);
  const overflow = await screen.findByText('+1');
  await user.hover(overflow);
  await screen.findByRole('tooltip');
  const items = { ...board.entities.items };
  delete items['item:1002'];
  board = { ...board, entities: { ...board.entities, items } };
  await act(async () => {
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
  });
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(screen.getByText('Add a searchable issue list')).toBeTruthy();
});
it('collapses and expands Unclassified work through the global canvas controls', async () => {
  const seed = await sample(),
    board = {
      ...seed,
      entities: {
        ...seed.entities,
        items: {
          ...seed.entities.items,
          'item:1007': { ...seed.entities.items['item:1007'], section: 'unclassified' as const },
        },
      },
    };
  const user = userEvent.setup();
  render(<FactoryApp client={new FactoryClient(async () => json(board))} />);
  await screen.findByRole('group', { name: 'Select Publish after prerequisites' });
  await user.click(screen.getByRole('button', { name: 'Collapse all sections' }));
  expect(screen.queryByRole('group', { name: 'Select Publish after prerequisites' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Expand all sections' }));
  expect(screen.getByRole('group', { name: 'Select Publish after prerequisites' })).toBeTruthy();
});

it('keeps unknown labels distinct from an observed empty list on a known PR', async () => {
  const seed = await sample(),
    issue = seed.entities.issues['issue:1003'];
  const board = {
    ...seed,
    entities: {
      ...seed.entities,
      issues: {
        ...seed.entities.issues,
        [issue.id]: {
          ...issue,
          metadata: {
            state: 'unknown' as const,
            sourceId: issue.metadata.sourceId,
            reason: 'Temporarily unavailable',
          },
        },
      },
    },
  };
  render(<FactoryApp client={new FactoryClient(async () => json(board))} />);
  const card = await screen.findByRole('group', { name: 'Select Expose observation metadata' });
  expect(card.textContent).toContain('Labels unavailable');
});
it('marks sources stale as time passes even when board requests return not-modified', async () => {
  const seed = await sample(),
    source = Object.values(seed.entities.sources)[0];
  const now = Date.now(),
    board = {
      ...seed,
      entities: {
        ...seed.entities,
        sources: {
          ...seed.entities.sources,
          [source.id]: { ...source, staleAt: new Date(now + 5000).toISOString() },
        },
      },
    };
  vi.useFakeTimers({ now });
  let reads = 0;
  const client = new FactoryClient(async () =>
    ++reads === 1 ? json(board) : new Response(null, { status: 304 })
  );
  await act(async () => {
    render(<FactoryApp client={client} />);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Factory settings' }));
  fireEvent.click(screen.getByText('Source coverage: complete'));
  expect(screen.queryByText(/ · stale/)).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(screen.getByText(/ · stale/)).toBeTruthy();
});
