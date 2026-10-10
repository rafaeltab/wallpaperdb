import { StrictMode, type ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { WallpaperCard } from '@/components/grid/WallpaperCard';
import type { Wallpaper } from '@/lib/graphql/types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const wallpaper: Wallpaper = {
  wallpaperId: 'a',
  profileId: 'contributor',
  variants: [
    {
      width: 1920,
      height: 1080,
      aspectRatio: 16 / 9,
      format: 'image/jpeg',
      fileSizeBytes: 1024,
      createdAt: '2026-01-01',
      url: 'https://media.example/a.jpg',
    },
  ],
  uploadedAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

function card(id = 'a') {
  return (
    <StrictMode>
      <WallpaperCard
        item={{
          id,
          src: wallpaper.variants[0].url,
          width: 1920,
          height: 1080,
          aspectRatio: 16 / 9,
          metadata: { wallpaper: { ...wallpaper, wallpaperId: id } },
        }}
        isExpanded
        span={{ cols: 1, rows: 1 }}
        onClick={() => {}}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />
    </StrictMode>
  );
}

describe('Wallpaper action feedback lifetime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', {
      share: undefined,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    // Cache denial is a supported fallback; exercise the real download adapter through fetch.
    vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('Cache unavailable')) });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    'copied',
    'failed',
  ] as const)('suppresses late %s feedback after unmount', async (outcome) => {
    const copy = deferred<void>();
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(copy.promise);
    const view = render(card());
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('/wallpapers/a')
    );
    view.unmount();
    await act(async () => {
      if (outcome === 'copied') copy.resolve();
      else copy.reject(new Error('Clipboard denied'));
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not revive old feedback when a card changes from A to B to A', async () => {
    const copy = deferred<void>();
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(copy.promise);
    const view = render(card());
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    view.rerender(card('b'));
    view.rerender(card('a'));
    await act(async () => {
      copy.resolve();
    });
    expect(toast.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await act(async () => {});
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('Link copied to clipboard');
  });

  it('keeps completion feedback for an unchanged card after a rerender', async () => {
    const copy = deferred<void>();
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(copy.promise);
    const view = render(card());
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    view.rerender(card());
    await act(async () => {
      copy.reject(new Error('Clipboard denied'));
    });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Failed to copy link');
  });

  it.each([
    'mounted',
    'unmounted',
    'replaced',
  ] as const)('reports a download failure only to its mounted owner: %s', async (state) => {
    const response = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response.promise)
    );
    const view = render(card());
    fireEvent.click(screen.getByRole('button', { name: 'Download original' }));
    await act(async () => {});
    expect(fetch).toHaveBeenCalledWith(wallpaper.variants[0].url);
    if (state === 'unmounted') view.unmount();
    if (state === 'replaced') view.rerender(card('b'));
    await act(async () => {
      response.reject(new Error('Network failure'));
    });
    if (state === 'mounted')
      expect(toast.error).toHaveBeenCalledExactlyOnceWith('Failed to download wallpaper');
    else expect(toast.error).not.toHaveBeenCalled();
  });

  it('finishes an accepted download after unmount', async () => {
    const response = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response.promise)
    );
    const createUrl = vi.fn(() => 'blob:download');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createUrl;
        static revokeObjectURL = vi.fn();
      }
    );
    const save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const view = render(card());
    fireEvent.click(screen.getByRole('button', { name: 'Download original' }));
    await act(async () => {});
    view.unmount();
    await act(async () => {
      response.resolve(new Response('image'));
    });
    expect(save).toHaveBeenCalledOnce();
    expect(createUrl).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
