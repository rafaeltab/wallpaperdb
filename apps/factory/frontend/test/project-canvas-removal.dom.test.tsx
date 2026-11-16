import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { Canvas } from '../src/canvas/canvas';
import type { ItemDependencyLinkRequest } from '../src/canvas/item-dependency-link-executor';
import { computeItemDependencyLinks } from '../src/canvas/item-dependency-links';

class HeldWorker extends EventTarget {
  static current: HeldWorker;
  requests: ItemDependencyLinkRequest[] = [];
  constructor() {
    super();
    HeldWorker.current = this;
  }
  postMessage(request: ItemDependencyLinkRequest) {
    this.requests.push(request);
  }
  terminate() {}
  complete() {
    const request = this.requests.shift();
    if (!request) throw new Error('Expected pending item dependency links');
    this.dispatchEvent(
      new MessageEvent('message', {
        data: { id: request.id, links: computeItemDependencyLinks(request.input) },
      })
    );
  }
}

beforeEach(() => {
  vi.stubGlobal('Worker', HeldWorker);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function board() {
  const app = fakeV2Server({ epoch: 'collapsed-removal' });
  try {
    return (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
  } finally {
    await app.close();
  }
}

function props(board: FactoryV2Snapshot): ComponentProps<typeof Canvas> {
  const noop = () => {};
  return {
    board,
    native: false,
    busy: false,
    titleMode: 'ellipsis',
    reach: 'all',
    onDetails: noop,
    onStart: noop,
    onCommand: noop,
    onSettings: noop,
    onPlan: noop,
    onStartIssue: noop,
    onPause: noop,
    canConfigure: true,
  };
}

it.each([false, true])(
  'prunes a deleted collapsed Project item dependency unless another item shares its link: %s',
  async (shared) => {
    const seed = await board();
    const initial: FactoryV2Snapshot = shared
      ? {
          ...seed,
          entities: {
            ...seed.entities,
            items: {
              ...seed.entities.items,
              'item:surviving': { ...seed.entities.items['item:1002'], id: 'item:surviving' },
            },
          },
        }
      : seed;
    const view = render(<Canvas {...props(initial)} />);
    await act(async () => HeldWorker.current.complete());
    fireEvent.click(view.getByRole('button', { name: 'Collapse all sections' }));
    await act(async () => HeldWorker.current.complete());
    const paths = [...view.container.querySelectorAll('.cc-line')].map((path) =>
      path.getAttribute('d')
    );
    expect(paths).toHaveLength(1);
    const items = { ...initial.entities.items };
    delete items['item:1002'];
    const next = { ...initial, entities: { ...initial.entities, items } };
    view.rerender(<Canvas {...props(next)} />);
    expect(view.container.querySelector('.cc-viewport')?.getAttribute('aria-busy')).toBe('true');
    const pending = [...view.container.querySelectorAll('.cc-line')].map((path) =>
      path.getAttribute('d')
    );
    expect(pending).toEqual(shared ? paths : []);
    await act(async () => HeldWorker.current.complete());
    expect(view.container.querySelectorAll('.cc-line')).toHaveLength(shared ? 1 : 0);
  }
);
