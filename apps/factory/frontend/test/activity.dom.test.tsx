import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FactoryActivity } from '../src/canvas/activity';
import type { ActivityFacts } from '../src/canvas/activity-model';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const facts: ActivityFacts = {
  observedAt: '2026-11-17T12:00:00Z',
  coverage: [],
  uncertainty: [],
  admissionReasons: [{ code: 'paused', message: 'Admissions paused' }],
  items: [
    {
      id: 'github',
      category: 'refreshing-github',
      lifecycle: 'current',
      startedAt: '2026-11-17T12:00:00Z',
      issue: null,
      pullRequest: null,
      reason: 'Reading metadata',
    },
  ],
};
it('opens details on focus, pins on click and dismisses with Escape or outside click', () => {
  render(
    <FactoryActivity
      facts={facts}
      paused
      refresh={{ failures: 0, lastSuccess: Date.parse(facts.observedAt) }}
    />
  );
  const button = screen.getByRole('button', { name: /Refreshing GitHub/ });
  fireEvent.mouseEnter(screen.getByRole('group', { name: 'Factory activity' }));
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  fireEvent.focus(button);
  expect(screen.getByRole('region', { name: 'Factory activity details' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Admissions paused' })).toBeTruthy();
  fireEvent.click(button);
  fireEvent.blur(button);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  fireEvent.pointerDown(document.body);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  act(() => button.focus());
  fireEvent.keyDown(button, { key: 'Escape' });
  expect(button.getAttribute('aria-expanded')).toBe('false');
});
it('advances durations and relative age locally, preserves the absolute timestamp and recalculates live groups', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(facts.observedAt));
  const refresh = { failures: 0, lastSuccess: Date.parse(facts.observedAt) };
  const { rerender, unmount } = render(
    <FactoryActivity facts={facts} paused={false} refresh={refresh} />
  );
  fireEvent.mouseEnter(screen.getByRole('group', { name: 'Factory activity' }));
  const panel = screen.getByRole('region', { name: 'Factory activity details' });
  const updated = within(panel).getByText(/Updated/).textContent;
  await act(() => vi.advanceTimersByTimeAsync(62000));
  expect(within(panel).getByText('1m 2s')).toBeTruthy();
  expect(within(panel).getByTitle('0 hours 1 minutes 2 seconds ago')).toBeTruthy();
  expect(within(panel).getByText(/Updated/).textContent).toBe(updated);
  rerender(<FactoryActivity facts={{ ...facts, items: [] }} paused={false} refresh={refresh} />);
  expect(screen.getByRole('button', { name: /Idle/ })).toBeTruthy();
  rerender(<FactoryActivity facts={facts} paused={false} refresh={{ ...refresh, failures: 3 }} />);
  expect(screen.getByRole('button', { name: /Disconnected/ })).toBeTruthy();
  expect(within(panel).getByText('Disconnected · last known data')).toBeTruthy();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('updates implementing counts and timers as newest work finishes or enters review', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
  const first: ActivityFacts['items'][number] = {
    id: 'one',
    category: 'implementing',
    lifecycle: 'current',
    issue: 1,
    pullRequest: null,
    startedAt: '2026-11-17T11:58:00Z',
    reason: 'Implementing',
  };
  const second = { ...first, id: 'two', issue: 2, startedAt: '2026-11-17T11:59:00Z' };
  const refresh = { failures: 0, lastSuccess: Date.parse(facts.observedAt) };
  const { rerender } = render(
    <FactoryActivity
      facts={{ ...facts, items: [first, second] }}
      paused={false}
      refresh={refresh}
    />
  );
  expect(screen.getByRole('button', { name: /Implementing 2 issues.*1m 0s/ })).toBeTruthy();
  fireEvent.focus(screen.getByRole('button'));
  rerender(
    <FactoryActivity facts={{ ...facts, items: [first] }} paused={false} refresh={refresh} />
  );
  expect(screen.getByRole('button', { name: /Implementing 1 issue.*2m 0s/ })).toBeTruthy();
  rerender(
    <FactoryActivity
      facts={{ ...facts, items: [first, { ...second, category: 'reviewing' }] }}
      paused={false}
      refresh={refresh}
    />
  );
  expect(screen.getByRole('button', { name: /Reviewing 1 issue/ })).toBeTruthy();
  const panel = screen.getByRole('region', { name: 'Factory activity details' });
  expect(within(panel).getByText('Implementing')).toBeTruthy();
  expect(within(panel).getAllByText('1 issue').length).toBe(2);
});

it('counts current publishing issues and advances the newest timer through joins, refreshes and departures', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(facts.observedAt));
  const refresh = { failures: 0, lastSuccess: Date.parse(facts.observedAt) };
  const older: ActivityFacts['items'][number] = {
    id: 'publish-1',
    category: 'publishing',
    lifecycle: 'current',
    issue: 1,
    pullRequest: null,
    startedAt: '2026-11-17T11:58:00Z',
    reason: 'Publishing reviewed changes',
  };
  const newer = { ...older, id: 'publish-2', issue: 2, startedAt: '2026-11-17T11:59:00Z' };
  const current = { ...facts, items: [...facts.items, older, newer] };
  const { rerender } = render(<FactoryActivity facts={current} paused={false} refresh={refresh} />);
  expect(screen.getByRole('button', { name: /Publishing 2 issues.*1m 0s/ })).toBeTruthy();
  fireEvent.focus(screen.getByRole('button', { name: /Publishing/ }));
  const panel = screen.getByRole('region', { name: 'Factory activity details' });
  expect(within(panel).getByText('Refreshing GitHub')).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  rerender(<FactoryActivity facts={{ ...current }} paused={false} refresh={refresh} />);
  expect(screen.getByRole('button', { name: /Publishing 2 issues.*1m 2s/ })).toBeTruthy();
  rerender(
    <FactoryActivity
      facts={{ ...facts, items: [...facts.items, older] }}
      paused={false}
      refresh={refresh}
    />
  );
  expect(screen.getByRole('button', { name: /Publishing 1 issue.*2m 2s/ })).toBeTruthy();
  rerender(<FactoryActivity facts={facts} paused={false} refresh={refresh} />);
  expect(screen.getByRole('button', { name: /Refreshing GitHub/ })).toBeTruthy();
});
