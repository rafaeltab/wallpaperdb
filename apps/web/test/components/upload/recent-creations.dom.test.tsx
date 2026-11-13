import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RecentCreations } from '@/components/upload/recent-creations';
import { recentCreations } from '@/features/wallpaper-creation/adapters/http';
import { resumeWallpaperWithDetails } from '@/lib/api/wallpaper';
vi.mock('@clerk/react', () => ({ useAuth: () => ({ userId: 'creator', isSignedIn: true }) }));
vi.mock('@/features/wallpaper-creation/adapters/http', () => ({
  recentCreations: vi.fn(),
  downloadOriginal: vi.fn(),
}));
vi.mock('@/lib/api/wallpaper', () => ({ resumeWallpaperWithDetails: vi.fn() }));
afterEach(() => cleanup());
it('offers a saved pending creation after remount and resumes its identity with the reselected file', async () => {
  const receipt = {
    wallpaperId: 'saved-wallpaper',
    state: 'creating-asset' as const,
    assetId: null,
    sourceId: null,
    createdAt: '2026-10-22T00:00:00Z',
  };
  vi.mocked(recentCreations).mockResolvedValue({ wallpapers: [receipt] });
  vi.mocked(resumeWallpaperWithDetails).mockResolvedValue({
    success: false,
    pending: true,
    isDuplicate: false,
    response: { wallpaperId: receipt.wallpaperId, uploadState: 'creating-asset' },
  });
  const firstClient = new QueryClient();
  const first = render(
    <QueryClientProvider client={firstClient}>
      <RecentCreations />
    </QueryClientProvider>
  );
  await screen.findByText(receipt.wallpaperId);
  first.unmount();
  firstClient.clear();
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <RecentCreations />
    </QueryClientProvider>
  );
  const input = await screen.findByLabelText('Resume this creation with its image');
  const file = new File(['image'], 'retained.jpg', { type: 'image/jpeg' });
  await userEvent.setup().upload(input, file);
  await waitFor(() =>
    expect(resumeWallpaperWithDetails).toHaveBeenCalledWith(
      file,
      'saved-wallpaper',
      expect.any(AbortSignal)
    )
  );
  expect(screen.getByText(receipt.wallpaperId)).toBeInTheDocument();
  client.clear();
});

it('opens older saved creations through a continuation and returns to the newest page', async () => {
  const recent = {
    wallpaperId: 'new',
    state: 'creating-asset' as const,
    assetId: null,
    sourceId: null,
    createdAt: '2026-10-22T00:00:00Z',
  };
  const older = { ...recent, wallpaperId: 'old' };
  vi.mocked(recentCreations).mockImplementation(async (_signal, cursor) =>
    cursor ? { wallpapers: [older] } : { wallpapers: [recent], nextCursor: 'continuation' }
  );
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <RecentCreations />
    </QueryClientProvider>
  );
  await screen.findByText('new');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Older creations' }));
  await screen.findByText('old');
  expect(screen.queryByText('new')).not.toBeInTheDocument();
  expect(vi.mocked(recentCreations)).toHaveBeenCalledWith(expect.any(AbortSignal), 'continuation');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Newest creations' }));
  await screen.findByText('new');
  client.clear();
});
