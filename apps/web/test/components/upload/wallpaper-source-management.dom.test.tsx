import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WallpaperSources } from '@/components/upload/wallpaper-sources';
import type { OwnedSources } from '@/features/wallpaper-creation';
import {
  browserSourceBatchApi,
  ownedSources,
  selectSourceDefault,
  withdrawSource,
} from '@/features/wallpaper-creation/adapters/http';
const auth = vi.hoisted(() => ({ userId: 'owner-a' }));
vi.mock('@clerk/react', () => ({ useAuth: () => auth }));
vi.mock('@/features/wallpaper-creation/adapters/http', () => ({
  browserSourceBatchApi: vi.fn(),
  ownedSources: vi.fn(),
  downloadSourceOriginal: vi.fn(),
  selectSourceDefault: vi.fn(),
  withdrawSource: vi.fn(),
}));
const clients: QueryClient[] = [];
beforeEach(() => {
  auth.userId = 'owner-a';
  vi.resetAllMocks();
  const unused = async (): Promise<never> => {
    throw new Error('No candidate intake for membership management');
  };
  vi.mocked(browserSourceBatchApi).mockReturnValue({
    identifier: () => 'intent',
    begin: unused,
    wallpaper: unused,
    list: unused,
    create: unused,
    status: unused,
    upload: unused,
    expectSource: unused,
    accept: unused,
    cancel: unused,
    wait: unused,
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
});
const initial: OwnedSources = {
  sourceSetRevision: '2',
  defaultSourceId: 'first',
  hasPendingCandidates: false,
  candidates: [],
  sources: [{ sourceId: 'first' }, { sourceId: 'second' }],
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const ui = (
    <QueryClientProvider client={client}>
      <WallpaperSources wallpaperId="same-wallpaper" assetId="same-asset" />
    </QueryClientProvider>
  );
  return { ...render(ui), ui, client };
}
it('keeps add and replacement available after sixteen accepted upload rows and a withdrawal', async () => {
  let saved: OwnedSources = { ...initial, sources: [], defaultSourceId: null };
  const wallpaper = {
    wallpaperId: 'same-wallpaper',
    assetId: 'same-asset',
    sourceId: 'first',
    state: 'published' as const,
    createdAt: 'now',
  };
  vi.mocked(ownedSources).mockImplementation(async () => saved);
  vi.mocked(browserSourceBatchApi).mockReturnValue({
    identifier: () => crypto.randomUUID(),
    begin: async () => wallpaper,
    wallpaper: async () => wallpaper,
    list: async () => saved,
    create: async (_asset, id, revision) => ({
      candidateId: id,
      status: 'awaiting-bytes',
      expectedSourceSetRevision: revision,
    }),
    status: async () => {
      throw new Error('Accepted files must not repeat');
    },
    upload: async (_asset, id) => ({
      candidateId: id,
      status: 'ready',
      expectedSourceSetRevision: saved.sourceSetRevision,
    }),
    accept: async (_asset, id, revision, _correlation, _signal, mutation) => {
      saved = {
        ...saved,
        sourceSetRevision: String(Number(revision) + 1),
        sources: [
          ...saved.sources.filter(
            (source) =>
              source.sourceId !==
              (mutation?.operation === 'replace-one' ? mutation.targetSourceId : undefined)
          ),
          { sourceId: id },
        ],
        defaultSourceId: saved.defaultSourceId ?? id,
      };
      return {
        candidateId: id,
        status: 'accepted',
        sourceId: id,
        expectedSourceSetRevision: revision,
      };
    },
    expectSource: async () => {},
    cancel: async () => {},
    wait: async () => {},
  });
  vi.mocked(withdrawSource).mockImplementation(async (_asset, id) => {
    saved = {
      ...saved,
      sources: saved.sources.filter((source) => source.sourceId !== id),
      sourceSetRevision: '19',
    };
  });
  const view = mount();
  const user = userEvent.setup();
  const input = screen.getByLabelText('Add Sources to this Wallpaper');
  await user.upload(
    input,
    Array.from({ length: 16 }, (_, i) => new File(['bytes'], `${i}.png`, { type: 'image/png' }))
  );
  await waitFor(() =>
    expect(
      screen
        .getAllByTestId('source-upload-outcome')
        .every((row) => row.textContent?.includes('Source accepted'))
    ).toBe(true)
  );
  const withdraw = screen
    .getAllByRole('button', { name: /^Withdraw Source/ })
    .find((button) => !button.hasAttribute('disabled'));
  if (!withdraw) throw new Error('Missing non-default Source');
  await user.click(withdraw);
  await screen.findByText('15 accepted Sources. Source revision 19.');
  expect(input).toBeEnabled();
  await user.upload(input, new File(['next'], 'next.png', { type: 'image/png' }));
  await waitFor(() => expect(screen.getAllByTestId('source-upload-outcome')).toHaveLength(17));
  await waitFor(() => expect(input).toBeEnabled());
  const replacement = screen.getAllByLabelText(/^Replace Source /)[0];
  if (!replacement) throw new Error('Missing replacement input');
  expect(replacement).toBeEnabled();
  await user.upload(replacement, new File(['replace'], 'replace.png', { type: 'image/png' }));
  await waitFor(() => expect(screen.getAllByTestId('source-upload-outcome')).toHaveLength(18));
  await waitFor(() => expect(input).toBeEnabled());
  view.unmount();
});
it('selects another Default and withdraws the previous Source using each displayed revision', async () => {
  let saved = initial;
  vi.mocked(ownedSources).mockImplementation(async () => saved);
  vi.mocked(selectSourceDefault).mockImplementation(async () => {
    saved = { ...saved, defaultSourceId: 'second', sourceSetRevision: '3' };
  });
  vi.mocked(withdrawSource).mockImplementation(async () => {
    saved = { ...saved, sources: [{ sourceId: 'second' }], sourceSetRevision: '4' };
  });
  mount();
  const user = userEvent.setup();
  const makeDefault = await screen.findByRole('button', { name: 'Make Default Source second' });
  expect(screen.getByRole('button', { name: 'Withdraw Source first' })).toBeDisabled();
  expect(screen.getByText('Change Default before withdrawing its Source.')).toBeInTheDocument();
  await user.click(makeDefault);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Withdraw Source first' })).toBeEnabled()
  );
  expect(selectSourceDefault).toHaveBeenCalledWith(
    'same-asset',
    'second',
    '2',
    expect.any(AbortSignal)
  );
  await user.click(screen.getByRole('button', { name: 'Withdraw Source first' }));
  await screen.findByText('1 accepted Sources. Source revision 4.');
  expect(withdrawSource).toHaveBeenCalledWith('same-asset', 'first', '3', expect.any(AbortSignal));
  expect(screen.queryByLabelText('Replace Source first')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Withdraw Source second' })).toBeDisabled();
});
it('reserves a membership command before yielding and keeps the accepted set after a conflict', async () => {
  vi.mocked(ownedSources).mockResolvedValue(initial);
  let reject: (cause: Error) => void = () => {
    throw new Error('Expected pending command');
  };
  vi.mocked(selectSourceDefault).mockImplementation(
    () =>
      new Promise((_resolve, failed) => {
        reject = failed;
      })
  );
  mount();
  const button = await screen.findByRole('button', { name: 'Make Default Source second' });
  act(() => {
    button.click();
    button.click();
  });
  expect(selectSourceDefault).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Withdraw Source second' })).toBeDisabled();
  expect(screen.getByLabelText('Replace Source first')).toBeDisabled();
  await act(async () =>
    reject(new Error('Sources changed. Review the current Sources and try again.'))
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Sources changed. Review the current Sources and try again.'
  );
  expect(screen.getByLabelText('Replace Source first')).toBeInTheDocument();
  expect(selectSourceDefault).toHaveBeenCalledTimes(1);
  expect(button).toBeEnabled();
});
it('cancels an earlier Owner command and suppresses its late feedback after session replacement', async () => {
  vi.mocked(ownedSources).mockImplementation(async () =>
    auth.userId === 'owner-a'
      ? initial
      : { ...initial, sources: [{ sourceId: 'other' }], defaultSourceId: 'other' }
  );
  let reject: (cause: Error) => void = () => {
    throw new Error('Expected pending command');
  };
  vi.mocked(selectSourceDefault).mockImplementation(
    () =>
      new Promise((_resolve, failed) => {
        reject = failed;
      })
  );
  const view = mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Make Default Source second' }));
  const signal = vi.mocked(selectSourceDefault).mock.calls[0]?.[3];
  auth.userId = 'owner-b';
  view.rerender(
    <QueryClientProvider client={view.client}>
      <WallpaperSources wallpaperId="same-wallpaper" assetId="same-asset" />
    </QueryClientProvider>
  );
  await screen.findByLabelText('Replace Source other');
  expect(signal?.aborted).toBe(true);
  await act(async () => reject(new Error('Old Owner failure')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Replace Source first')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Replace Source other')).toBeEnabled();
});
it('shows loading, an empty saved set and a failed read without exposing management commands', async () => {
  let finish: (value: OwnedSources) => void = () => {
    throw new Error('Expected read');
  };
  vi.mocked(ownedSources).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const view = mount();
  expect(screen.getByText('Loading accepted Sources…')).toBeInTheDocument();
  await act(async () =>
    finish({ ...initial, sources: [], defaultSourceId: null, sourceSetRevision: '0' })
  );
  await screen.findByText('0 accepted Sources. Source revision 0.');
  expect(
    screen.queryByRole('button', { name: /Make Default|Withdraw Source/ })
  ).not.toBeInTheDocument();
  vi.mocked(ownedSources).mockRejectedValue(new Error('Unavailable'));
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['wallpaper-sources', 'owner-a', 'same-asset'] });
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Source progress is temporarily unavailable. Accepted Sources remain saved.'
  );
});
