import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { commands, stage, type ScheduleSnapshot } from '../src/api';
import { ObservationNotice } from '../src/app';
import { ExternalLink } from '../src/links';
import { PlanResult } from '../src/preview';
import { createElement } from 'react';
it('labels only observed stages, with no fabricated progress for failure or unknown phases', () => {
  expect(stage('discovery')).toEqual({ label: 'Gathering issues', value: 1 });
  expect(stage('handoff')).toEqual({ label: 'Handing off to planner', value: 2 });
  expect(stage('freshness')).toEqual({ label: 'Validating freshness', value: 3 });
  expect(stage('succeeded')).toEqual({ label: 'Preview succeeded', value: 4 });
  expect(stage('failed')).toEqual({ label: 'Preview failed', value: undefined });
  expect(stage('waiting')).toEqual({ label: 'waiting', value: undefined });
});
it('reserves the command before yielding and releases it after an uncertain response', async () => {
  let release!: () => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((_resolve, reject) => {
        release = () => reject(new TypeError('offline'));
      })
  );
  vi.stubGlobal('fetch', fetcher);
  try {
    const send = commands();
    const first = send('/api/job/resume', { jobId: 'existing', runId: 'run', revision: 3 });
    await expect(send('/api/job/cancel', { jobId: 'existing' })).rejects.toThrow('already pending');
    expect(fetcher).toHaveBeenCalledTimes(1);
    release();
    await expect(first).rejects.toThrow('Request uncertain');
    fetcher.mockResolvedValueOnce(new Response('{}'));
    await expect(send('/api/job/cancel', { jobId: 'existing' })).resolves.toEqual({});
  } finally {
    vi.unstubAllGlobals();
  }
});
it.each(['initial', 'loading', 'current', 'stale', 'error'] as const)(
  'dates last-known %s facts and keeps missing observations unknown',
  (state) => {
    const snapshot: ScheduleSnapshot = {
      state: { revision: 0, concurrency: 1, allowance: 1, paused: true, admissions: [] },
      jobs: [],
      localWork: [],
      observations: {
        state,
        stale: state !== 'current',
        observedAt: 0,
        error: state === 'error' ? 'offline' : undefined,
      },
    };
    const html = renderToStaticMarkup(createElement(ObservationNotice, { snapshot }));
    expect(html).toContain(`GitHub: ${state}`);
    expect(html).toContain('1970-01-01T00:00:00.000Z');
    expect(html).toContain('Last job observation: Unknown');
    expect(html).toContain('GitHub facts unknown');
  }
);
it.each([
  'javascript:alert(1)',
  'data:text/html,unsafe',
  'https://github.com.evil.test/path',
  'https://user:secret@github.com/path',
])('keeps unsafe external links as text: %s', (href) => {
  expect(
    renderToStaticMarkup(<ExternalLink href={href}>External text</ExternalLink>)
  ).not.toContain('<a');
});

it('renders external proposal prose as text while retaining issue context and dependency links', () => {
  const html = renderToStaticMarkup(
    <PlanResult
      result={{
        kind: 'preview',
        input: {
          issues: [{ number: 12, title: '<script>unsafe</script>', blockers: [4], parents: [2] }],
        },
        selected: [
          { issue: 12, reason: '<img src=x onerror=alert(1)>', includeCodeFromIssues: [4, 5] },
        ],
        rejected: [{ issue: 3, reason: 'Not ready' }],
      }}
    />
  );
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
  expect(html).toContain('https://github.com/rafaeltab/wallpaperdb/issues/4');
  expect(html).toContain('Parent specs');
  expect(html).toContain('No work was dispatched.');
});
