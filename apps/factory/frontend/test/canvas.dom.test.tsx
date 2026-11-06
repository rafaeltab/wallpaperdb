import { act, cleanup, render, screen } from '@testing-library/react';
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
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText(/Showing last-known board/);
  expect(screen.getByText('Implement the command centre')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Settings' }));
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
  await user.click(screen.getByRole('button', { name: 'Settings' }));
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
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
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
  const user = userEvent.setup();
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
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('Work items unavailable. Check source coverage.');
  expect(screen.getByRole('button', { name: '0+ need attention' })).toBeTruthy();
});
it('keeps uncertain commands recoverable inside the originating dialog without creating a new UUID', async () => {
  const board = await sample(),
    bodies: string[] = [];
  const client = new FactoryClient(async (path, init) => {
    if (init?.method === 'POST') {
      bodies.push(String(init.body));
      if (bodies.length === 1) throw new TypeError('Connection lost');
      return json({ commandId: JSON.parse(bodies[0]).commandId, state: 'succeeded', reasons: [] });
    }
    if (String(path).includes('/commands/'))
      return new Response(JSON.stringify({ detail: 'Receipt not found' }), { status: 404 });
    return json(board);
  });
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  await screen.findByText('Implement the command centre');
  await user.click(screen.getByRole('button', { name: 'Settings' }));
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
});
