import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { Preview } from '../src/preview';
import type { ScheduleSnapshot } from '../src/api';
const base = (): ScheduleSnapshot => ({
  state: { revision: 1, concurrency: 1, allowance: 1, paused: true, admissions: [] },
  jobs: [],
  localWork: [],
  observations: {
    state: 'current',
    stale: false,
    observedAt: 0,
    jobsObservedAt: 0,
    facts: { issues: [], pullRequests: [] },
  },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('retains a newer observed revision when an earlier save response arrives late', async () => {
  const initial = base();
  const newer = { ...initial, state: { ...initial.state, revision: 3, concurrency: 7 } };
  let reads = 0;
  let completeSave!: (response: Response) => void;
  vi.stubGlobal('fetch', (_path: string, options?: RequestInit) => {
    if (options?.method)
      return new Promise<Response>((resolve) => {
        completeSave = resolve;
      });
    if (++reads === 1) return Promise.resolve(json(initial));
    if (reads === 2) return Promise.resolve(json(newer));
    return new Promise<Response>(() => {});
  });
  vi.useFakeTimers();
  await act(async () => {
    render(<App />);
  });
  await act(async () => {
    screen
      .getByRole('button', { name: 'Save scheduler controls' })
      .closest('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByText(/Latest observed revision 3/)).toBeTruthy();
  await act(async () => {
    completeSave(json({ state: { ...initial.state, revision: 2 } }));
  });
  expect(screen.getByText(/Editing revision 3\. Latest observed revision 3/)).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>('Concurrency').value).toBe('7');
});

it('adopts saved controls and their revision before a slow observation completes', async () => {
  const initial = base();
  const submitted: unknown[] = [];
  let reads = 0;
  vi.stubGlobal('fetch', async (_path: string, options?: RequestInit) => {
    if (!options?.method) {
      if (reads++ === 0) return json(initial);
      return new Promise<Response>(() => {});
    }
    const body = JSON.parse(String(options.body));
    submitted.push(body);
    return json({ state: { ...initial.state, ...body, revision: body.revision + 1 } });
  });
  const user = userEvent.setup();
  render(<App />);
  const field = await screen.findByLabelText<HTMLInputElement>('Concurrency');
  await user.clear(field);
  await user.type(field, '3');
  await user.click(screen.getByRole('button', { name: 'Save scheduler controls' }));
  await screen.findByText(/Editing revision 2\. Latest observed revision 2/);
  expect(field.value).toBe('3');
  await user.clear(field);
  await user.type(field, '4');
  await user.click(screen.getByRole('button', { name: 'Save scheduler controls' }));
  expect(submitted).toEqual([
    { revision: 1, concurrency: 3, allowance: 1, paused: true },
    { revision: 2, concurrency: 4, allowance: 1, paused: true },
  ]);
});

it('sends the selected issue/context and continues/cancels the same observed job explicitly', async () => {
  let snapshot = base();
  const commands: { path: string; body: unknown }[] = [];
  const job = {
    kind: 'job' as const,
    intent: {
      id: 'existing',
      issue: 12,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/12',
      base: 'a'.repeat(40),
      context: 'Read only',
      branch: 'worker',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    },
    execution: {
      kind: 'found' as const,
      threadId: 'thread',
      status: 'completed',
      branch: 'worker',
      worktree: '<unsafe>',
      model: 'model',
    },
    elapsedMs: 4000,
    resume: { index: 0, questionId: 'answered' },
    delivery: {
      stage: 'implementation' as const,
      commit: 'a'.repeat(40),
      ready: false,
      landed: false,
      activity: 'awaiting-answer' as const,
    },
  };
  vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
    if (!options?.method) return json(snapshot);
    const body = JSON.parse(String(options.body));
    commands.push({ path, body });
    if (path === '/api/job') snapshot = { ...snapshot, jobs: [job] };
    if (path === '/api/job/resume')
      snapshot = {
        ...snapshot,
        jobs: [
          {
            ...job,
            resume: undefined,
            execution: { ...job.execution, status: 'running' },
            delivery: { ...job.delivery, activity: undefined },
          },
        ],
      };
    if (path === '/api/job/cancel')
      snapshot = {
        ...snapshot,
        jobs: [{ ...job, resume: undefined, delivery: { ...job.delivery, activity: 'cancelled' } }],
      };
    return json({ kind: 'job' });
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByLabelText('Selected issue number');
  await user.type(screen.getByLabelText('Selected issue number'), '12');
  await user.type(screen.getByLabelText('Maintainer execution context'), 'Read only');
  await user.click(screen.getByRole('button', { name: 'Start selected issue' }));
  await screen.findByText(/Active capacity released/);
  await user.click(screen.getByRole('button', { name: 'Resume existing job' }));
  await screen.findByText('Status: running');
  await user.click(screen.getByRole('button', { name: 'Cancel job' }));
  await screen.findByText('cancelled');
  expect(commands).toEqual([
    { path: '/api/job', body: { issue: 12, context: 'Read only' } },
    { path: '/api/job/resume', body: { jobId: 'existing', index: 0, questionId: 'answered' } },
    { path: '/api/job/cancel', body: { jobId: 'existing' } },
  ]);
  expect(screen.queryByRole('button', { name: 'Cancel job' })).toBeNull();
  expect(screen.getByText(/<unsafe>/)).toBeTruthy();
});

it('reports rejected commands and unavailable observations, retains facts, and restarts polling after page restoration', async () => {
  let offline = false;
  let reads = 0;
  let hold: (() => void) | undefined;
  let snapshot = base();
  vi.stubGlobal('fetch', async (_path: string, options?: RequestInit) => {
    if (options?.method) return json({ title: 'Controls changed. Refresh observation.' }, 409);
    reads++;
    if (offline) throw new TypeError('offline');
    if (hold)
      await new Promise<void>((resolve) => {
        hold = resolve;
      });
    return json(snapshot);
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByLabelText('Concurrency');
  await user.click(screen.getByLabelText('Pause admissions'));
  await user.click(screen.getByRole('button', { name: 'Save scheduler controls' }));
  await screen.findByText('Controls changed. Refresh observation.');
  offline = true;
  await user.click(screen.getByRole('link', { name: 'Refresh observation' }));
  await screen.findByText(
    'Observations unavailable. Displaying last-known facts; refresh before commands.'
  );
  expect(screen.getByText('Last GitHub observation: 1970-01-01T00:00:00.000Z')).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Save scheduler controls' }).disabled
  ).toBe(true);
  act(() => window.dispatchEvent(new Event('pagehide')));
  offline = false;
  const before = reads;
  act(() => window.dispatchEvent(new Event('pageshow')));
  await waitFor(() => expect(reads).toBeGreaterThan(before));
  await screen.findByText('Observations refresh automatically.');
  // A response owned by the hidden page cannot publish into the restored lifetime.
  hold = () => {};
  await user.click(screen.getByRole('link', { name: 'Refresh observation' }));
  await waitFor(() => expect(reads).toBeGreaterThan(before + 1));
  act(() => window.dispatchEvent(new Event('pagehide')));
  snapshot = {
    ...snapshot,
    observations: {
      state: 'error',
      stale: true,
      observedAt: 9000,
      error: 'Superseded observation',
    },
  };
  await act(async () => {
    hold?.();
  });
  expect(screen.queryByText(/Superseded observation/)).toBeNull();
  expect(screen.getByText('GitHub: current.')).toBeTruthy();
  expect(screen.getByText('Last GitHub observation: 1970-01-01T00:00:00.000Z')).toBeTruthy();
});

it('keeps stage progress visible through freshness validation, renders advisory results and reports terminal and transport failures', async () => {
  let phase = 'discovery';
  let offline = false;
  const proposal = {
    kind: 'preview',
    input: {
      issues: [{ number: 12, title: '<script>untrusted</script>', blockers: [4], parents: [2] }],
    },
    selected: [{ issue: 12, reason: 'Thin experiment', dependsOn: [4], conflicts: [5] }],
    rejected: [],
  };
  vi.stubGlobal('fetch', async (_path: string, options?: RequestInit) => {
    if (offline) throw new TypeError('offline');
    return options?.method
      ? json({ id: 'attempt' }, 202)
      : json({
          id: 'attempt',
          phase,
          elapsedMs: 3000,
          result: proposal,
          detail: phase === 'failed' ? 'Freshness failed' : undefined,
        });
  });
  const user = userEvent.setup();
  render(<Preview />);
  await user.click(screen.getByRole('button', { name: 'Generate plan preview' }));
  await screen.findByText('Gathering issues (3s)');
  expect(screen.getByRole<HTMLProgressElement>('progressbar').value).toBe(1);
  phase = 'freshness';
  await screen.findByText('Validating freshness (3s)', {}, { timeout: 2000 });
  phase = 'succeeded';
  await screen.findByText('Validated advisory proposal', {}, { timeout: 2000 });
  expect(screen.getByText('No work was dispatched.')).toBeTruthy();
  expect(screen.getByText('<script>untrusted</script>')).toBeTruthy();
  expect(document.querySelector('#plan script')).toBeNull();
  phase = 'failed';
  await user.click(screen.getByRole('button', { name: 'Generate plan preview' }));
  await screen.findByText('Freshness failed');
  expect(screen.getByText('Preview failed (3s)')).toBeTruthy();
  offline = true;
  await user.click(screen.getByRole('button', { name: 'Generate plan preview' }));
  await screen.findByText('Request uncertain. Refresh observation before retrying.');
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Generate plan preview' }).disabled
  ).toBe(false);
});
