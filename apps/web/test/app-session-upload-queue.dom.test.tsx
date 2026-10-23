import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, StrictMode, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { useUploadQueue } from '@/contexts/upload-queue-context';
import { uploadWallpaperWithDetails, type UploadResult } from '@/lib/api/wallpaper';

const session = vi.hoisted<{ userId: string | undefined }>(() => ({ userId: undefined }));
vi.mock('@clerk/react', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ userId: session.userId }),
}));
vi.mock('@tanstack/react-query-devtools', () => ({ ReactQueryDevtools: () => null }));
vi.mock('@tanstack/react-router', () => ({
  createRouter: () => ({}),
  RouterProvider: () => <InteractivePage />,
}));
vi.mock('../src/routeTree.gen', () => ({ routeTree: {} }));
vi.mock('@/components/auth-bridge', () => ({
  AuthBridge: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/profile-bootstrap', () => ({ ProfileBootstrap: () => null }));
vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('@/lib/api/wallpaper', () => ({ uploadWallpaperWithDetails: vi.fn() }));

function InteractivePage() {
  const [expanded, setExpanded] = useState(false);
  const { addFiles, counts } = useUploadQueue();
  return (
    <>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        Catalogue card
      </button>
      <button type="button" onClick={() => addFiles([new File(['image'], 'image.jpg')])}>
        Upload
      </button>
      <output aria-label="Queued files">{counts.total}</output>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('retains interactive page state and focus when the initial Owner identity resolves', async () => {
  session.userId = undefined;
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>
  );
  const card = screen.getByRole('button', { name: 'Catalogue card' });
  await userEvent.setup().click(card);
  expect(card).toHaveAttribute('aria-expanded', 'true');
  expect(card).toHaveFocus();
  session.userId = 'owner-a';
  view.rerender(
    <StrictMode>
      <App />
    </StrictMode>
  );
  expect(screen.getByRole('button', { name: 'Catalogue card' })).toBe(card);
  expect(card).toHaveAttribute('aria-expanded', 'true');
  expect(card).toHaveFocus();
});

it('replaces only the queue on account changes and cancels its previous Owner work', async () => {
  session.userId = 'owner-a';
  const requests: {
    signal: AbortSignal | null | undefined;
    resolve: (result: UploadResult) => void;
  }[] = [];
  vi.mocked(uploadWallpaperWithDetails).mockImplementation(
    (_file, _key, signal) =>
      new Promise((resolve) => {
        requests.push({ signal, resolve });
      })
  );
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Upload' }));
  const card = screen.getByRole('button', { name: 'Catalogue card' });
  await user.click(card);
  expect(requests).toHaveLength(1);
  view.rerender(
    <StrictMode>
      <App />
    </StrictMode>
  );
  expect(requests[0].signal?.aborted).toBe(false);
  expect(screen.getByLabelText('Queued files')).toHaveTextContent('1');
  session.userId = 'owner-b';
  view.rerender(
    <StrictMode>
      <App />
    </StrictMode>
  );
  expect(requests[0].signal?.aborted).toBe(true);
  expect(screen.getByLabelText('Queued files')).toHaveTextContent('0');
  expect(screen.getByRole('button', { name: 'Catalogue card' })).toBe(card);
  expect(card).toHaveAttribute('aria-expanded', 'true');
  expect(card).toHaveFocus();
  await act(async () =>
    requests[0].resolve({
      success: true,
      isDuplicate: false,
      response: { wallpaperId: 'old-owner-wallpaper', uploadState: 'published' },
    })
  );
  expect(screen.getByLabelText('Queued files')).toHaveTextContent('0');
  await user.click(screen.getByRole('button', { name: 'Upload' }));
  expect(requests).toHaveLength(2);
  expect(requests[1].signal?.aborted).toBe(false);
  expect(screen.getByLabelText('Queued files')).toHaveTextContent('1');
  view.unmount();
  expect(requests[1].signal?.aborted).toBe(true);
});
