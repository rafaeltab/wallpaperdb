import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { ProfileSettingsPage } from '@/components/profile/profile-settings-page';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';

vi.mock('@clerk/react', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api/user', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/user')>();
  return {
    ...original,
    userApi: { ensureProfile: vi.fn(), updateProfile: vi.fn() },
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const profile: Profile = {
  id: 'user_123',
  handle: 'wallpaper-fan',
  displayName: 'Wallpaper Fan',
  biographyMarkdown: '',
  pictureAssetId: null,
  version: 1,
  createdAt: '2026-07-12T12:00:00.000Z',
  updatedAt: '2026-07-12T12:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(profileQueryKey(profile.id), profile);
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ProfileSettingsPage />
      </QueryClientProvider>
    ),
  };
}

describe('ProfileSettingsPage', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      getToken: vi.fn().mockResolvedValue('token'),
      isLoaded: true,
      isSignedIn: true,
      userId: profile.id,
    } as ReturnType<typeof useAuth>);
    vi.mocked(userApi.ensureProfile).mockReset();
    vi.mocked(userApi.updateProfile).mockReset();
  });

  it('shows the current Display name and immediately adopts the REST response', async () => {
    const updated = { ...profile, displayName: 'Éowyn 雪', version: 2 };
    vi.mocked(userApi.updateProfile).mockResolvedValue(updated);
    const { queryClient } = renderPage();
    const user = userEvent.setup();

    const input = screen.getByRole('textbox', { name: /display name/i });
    expect(input).toHaveValue('Wallpaper Fan');
    await user.clear(input);
    await user.type(input, '  Éowyn   雪  ');
    await user.click(screen.getByRole('button', { name: /save display name/i }));

    await waitFor(() => expect(input).toHaveValue('Éowyn 雪'));
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    expect(userApi.updateProfile).toHaveBeenCalledWith({
      displayName: '  Éowyn   雪  ',
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(screen.getByText('Display name saved.')).toBeInTheDocument();
  });

  it('retains unsaved input and explains a stale edit', async () => {
    vi.mocked(userApi.updateProfile).mockRejectedValue(
      new UserApiError('Profile has changed since it was last loaded', 409)
    );
    renderPage();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: /display name/i });

    await user.clear(input);
    await user.type(input, 'My unsaved name');
    await user.click(screen.getByRole('button', { name: /save display name/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your Profile changed elsewhere. Reload before saving again.'
    );
    expect(input).toHaveValue('My unsaved name');
  });

  it('validates the 80-character limit before sending', async () => {
    renderPage();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: /display name/i });

    await user.clear(input);
    await user.type(input, 'a'.repeat(81));
    await user.click(screen.getByRole('button', { name: /save display name/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('at most 80 characters');
    expect(userApi.updateProfile).not.toHaveBeenCalled();
  });
});
