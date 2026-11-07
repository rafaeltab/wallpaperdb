import { render, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { Canvas } from '../src/canvas/canvas';
import { issueRoutingBoard } from './fixtures/canvas/issue-routing';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function board() {
  const app = fakeV2Server({ epoch: 'issue-route' });
  try {
    return issueRoutingBoard((await app.inject('/api/v2/board')).json<FactoryV2Snapshot>());
  } finally {
    await app.close();
  }
}
function mount(value: FactoryV2Snapshot) {
  const noop = () => {};
  return render(
    <Canvas
      board={value}
      native={false}
      busy={false}
      titleMode="ellipsis"
      reach="direct"
      onDetails={noop}
      onStart={noop}
      onCommand={noop}
      onSettings={noop}
      onPlan={noop}
      onStartIssue={noop}
      onPause={noop}
      canConfigure={false}
    />
  );
}
it('keeps wrapped sibling prerequisite connections continuous and clear of cards and parent headers', async () => {
  const { container } = mount(await board());
  const cards = [...container.querySelectorAll<HTMLElement>('.cc-item')];
  const source = cards.find((el) => el.getAttribute('aria-label') === 'Select Issue 250');
  const target = cards.find((el) => el.getAttribute('aria-label') === 'Select Issue 461');
  const heading = container.querySelector<HTMLElement>('.cc-parent-head[data-card]');
  if (!source || !target || !heading)
    throw new Error('Expected the prerequisite, dependant card and parent heading');
  for (const destination of [target, heading]) {
    const path = container.querySelector<SVGElement>(
      `[data-edge="${source.dataset.card}-${destination.dataset.card}"]`
    );
    expect(path, 'Retain both the card and parent-heading connection').toBeTruthy();
    expect(path?.dataset.failed).toBe('false');
    const points: { x: number; y: number }[] = JSON.parse(path?.dataset.points ?? '[]');
    expect(points.length).toBeGreaterThan(2);
    const obstacles = [
      ...cards.map((el) => ({
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        width: parseFloat(el.style.width),
        height: parseFloat(el.style.height),
      })),
      ...Array.from(container.querySelectorAll<HTMLElement>('.cc-parent-head'), (el) => {
        const group = el.parentElement;
        if (!group) throw new Error('Expected heading group');
        return {
          x: parseFloat(group.style.left),
          y: parseFloat(group.style.top),
          width: parseFloat(group.style.width),
          height: parseFloat(el.style.height),
        };
      }),
    ];
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1],
        b = points[index];
      expect(a.x === b.x || a.y === b.y, 'No diagonal fallback').toBe(true);
      for (const rect of obstacles) {
        const inside =
          a.x === b.x
            ? a.x > rect.x &&
              a.x < rect.x + rect.width &&
              Math.max(a.y, b.y) > rect.y &&
              Math.min(a.y, b.y) < rect.y + rect.height
            : a.y > rect.y &&
              a.y < rect.y + rect.height &&
              Math.max(a.x, b.x) > rect.x &&
              Math.min(a.x, b.x) < rect.x + rect.width;
        expect(inside, 'Route must not enter any card or heading').toBe(false);
      }
    }
  }
});
it('describes unknown project fields differently from known absent fields', async () => {
  const known = await board(),
    issue = known.entities.issues['issue:visual-461'];
  const value = {
    ...known,
    entities: {
      ...known.entities,
      issues: {
        ...known.entities.issues,
        [issue.id]: {
          ...issue,
          project: {
            state: 'unknown' as const,
            sourceId: issue.project.sourceId,
            reason: 'Unavailable',
          },
        },
      },
    },
  };
  const { container } = mount(value);
  const card = Array.from(container.querySelectorAll('.cc-item')).find(
    (el) => el.getAttribute('aria-label') === 'Select Issue 461'
  );
  if (!card) throw new Error('Expected issue card');
  expect(card.querySelector('.cc-fields>span:first-child')?.textContent).toBe('?');
  const user = userEvent.setup();
  const priority = card.querySelector('.cc-fields>span:first-child'),
    size = card.querySelector('.cc-size');
  if (!priority || !size) throw new Error('Expected project fields');
  await user.hover(priority);
  expect(screen.getByRole('tooltip').textContent).toBe('Priority unavailable');
  await user.hover(size);
  expect(screen.getByRole('tooltip').textContent).toBe('Size unavailable');
  const knownPriority = screen.getAllByText('P—')[0];
  await user.hover(knownPriority);
  expect(screen.getByRole('tooltip').textContent).toBe('Priority not set');
  const knownSize = knownPriority.parentElement?.querySelector('.cc-size');
  if (!knownSize) throw new Error('Expected known size field');
  expect(knownSize.textContent).toBe('—');
  await user.hover(knownSize);
  expect(screen.getByRole('tooltip').textContent).toBe('Size not set');
});
