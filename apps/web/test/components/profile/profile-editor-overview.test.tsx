import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { ProfileSettingsPage } from '@/components/profile/profile-settings-page';
import { type Profile } from '@/lib/api/user';

vi.mock('@clerk/react', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/graphql/client', () => ({
  request: vi.fn().mockResolvedValue({ getWallpaper: null }),
}));
vi.mock('@/lib/api/user', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/user')>();
  return {
    ...original,
    userApi: { ...original.userApi, ensureProfile: vi.fn(), updateProfile: vi.fn() },
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/profiles/@ada">{children}</a>,
}));
const profile: Profile = {
  id: 'user_123',
  handle: 'ada',
  displayName: 'Ada Lovelace',
  biographyMarkdown: 'Original Biography',
  pictureAssetId: null,
  pictureImportStatus: 'complete',
  version: 1,
  biographyMaxLength: 5000,
  createdAt: '2026-07-12T12:00:00.000Z',
  updatedAt: '2026-07-12T12:00:00.000Z',
};
function renderPage(initial = profile) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(profileQueryKey(profile.id), initial);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ProfileSettingsPage />
      </QueryClientProvider>
    ),
  };
}

describe('Production profile overview', () => {
  beforeEach(() => {
    vi.mocked(useAuth, { partial: true }).mockReturnValue({ getToken: vi.fn().mockResolvedValue('token'), isLoaded: true, isSignedIn: true, userId: profile.id });
  });
  it('starts with a minimal overview and opens the matching public preview without wallpapers', async () => {
    renderPage();
    const user = userEvent.setup();
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === '@ada')).toBeInTheDocument();
    expect(screen.getByText('Original Biography')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View profile' }));
    const preview = screen.getByRole('dialog', { name: 'Profile preview' });
    expect(within(preview).getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(within(preview).getByText('Original Biography')).toBeInTheDocument();
    expect(within(preview).queryByText('Wallpapers')).not.toBeInTheDocument();
    expect(within(preview).getByRole('link', { name: 'Open your profile' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View profile' })).toHaveFocus();
  });
});
