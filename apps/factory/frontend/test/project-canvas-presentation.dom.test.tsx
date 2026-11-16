import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { Canvas } from '../src/canvas/canvas';

beforeEach(() => vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  { locked: false, titleMode: 'ellipsis' },
  { locked: true, titleMode: 'ellipsis' },
  { locked: false, titleMode: 'expand' },
  { locked: true, titleMode: 'expand' },
] as const)(
  'keeps unrelated Project item presentation unchanged during hover/focus: $locked/$titleMode',
  async ({ locked, titleMode }) => {
    const app = fakeV2Server({ epoch: 'presentation-isolation' });
    const seed = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    await app.close();
    const tracked = seed.entities.items['item:1003'];
    let reads = 0;
    // Observe actual public presentation-data access, not private component calls
    // or identical DOM output that could hide redundant React renders.
    const item = {
      ...tracked,
      get threadIds() {
        reads++;
        return tracked.threadIds;
      },
    };
    const board = {
      ...seed,
      entities: { ...seed.entities, items: { ...seed.entities.items, [item.id]: item } },
    };
    const noop = () => {};
    const props: ComponentProps<typeof Canvas> = {
      board,
      native: false,
      busy: false,
      titleMode,
      reach: 'direct',
      onDetails: noop,
      onStart: noop,
      onCommand: noop,
      onSettings: noop,
      onPlan: noop,
      onStartIssue: noop,
      onPause: noop,
      canConfigure: true,
    };
    const view = render(<Canvas {...props} />);
    const ready = () =>
      waitFor(() =>
        expect(view.container.querySelector('.cc-viewport')?.getAttribute('aria-busy')).toBe(
          'false'
        )
      );
    await ready();
    const [first, second] = view.container.querySelectorAll<HTMLElement>('.cc-issue-card');
    if (!first || !second) throw new Error('Expected two separate Project items');
    fireEvent.pointerOver(first);
    if (locked) fireEvent.click(first);
    const before = reads;
    fireEvent.pointerOut(first, { relatedTarget: second });
    fireEvent.pointerOver(second, { relatedTarget: first });
    fireEvent.focus(second);
    const title = second.querySelector('.cc-title');
    if (!title) throw new Error('Expected a Project item title');
    await act(async () => fireEvent.pointerMove(title));
    await ready();
    expect(locked ? first : second).toHaveProperty(
      'className',
      expect.stringContaining('cc-selected')
    );
    expect(reads, 'Unchanged item content must not render again for another item interaction').toBe(
      before
    );
    const updated = { ...item, status: { ...item.status, label: 'Updated presentation' } };
    view.rerender(
      <Canvas
        {...props}
        board={{
          ...board,
          entities: { ...board.entities, items: { ...board.entities.items, [item.id]: updated } },
        }}
      />
    );
    await ready();
    expect(view.getAllByText('Updated presentation').length).toBeGreaterThan(0);
  }
);
