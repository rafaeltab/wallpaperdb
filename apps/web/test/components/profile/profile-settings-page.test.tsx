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
    userApi: { ensureProfile: vi.fn(), updateProfile: vi.fn(), updateHandle: vi.fn() },
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children: React.ReactNode; to: string; params?: { handle: string } }) => (
    <a href={params ? `/profiles/@${params.handle}` : to}>{children}</a>
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

function renderPage(initialProfile: Profile = profile) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(profileQueryKey(initialProfile.id), initialProfile);
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
    vi.mocked(userApi.updateHandle).mockReset();
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

  it('changes the Handle and immediately links to the authoritative Profile', async () => {
    const updated = { ...profile, handle: 'new-handle', version: 2 };
    vi.mocked(userApi.updateHandle).mockResolvedValue(updated);
    const { queryClient } = renderPage();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: /^handle$/i });

    expect(input).toHaveValue(profile.handle);
    await user.clear(input);
    await user.type(input, 'New Handle');
    await user.click(screen.getByRole('button', { name: /change handle/i }));

    await waitFor(() => expect(input).toHaveValue('new-handle'));
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    expect(userApi.updateHandle).toHaveBeenCalledWith({
      handle: 'New Handle',
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(screen.getByText('@new-handle')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Handle changed to @new-handle.');
    expect(screen.getByRole('status')).toHaveTextContent('Your previous Profile address will redirect to your new one.');
    expect(screen.getByRole('link', { name: /view your profile/i })).toHaveAttribute('href', '/profiles/@new-handle');
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

  it.each([
    ['invalid-handle', 400, 'Handle must contain between 1 and 30 characters.', 'Handle must contain between 1 and 30 characters.'],
    ['handle-unavailable', 409, 'That Handle is already in use.', 'That Handle is already in use.'],
    ['profile-version-conflict', 409, 'Profile has changed.', 'Your Profile changed elsewhere. Reload before saving again.'],
  ])('preserves the Handle draft and explains %s', async (type, status, detail, expected) => {
    vi.mocked(userApi.updateHandle).mockRejectedValue(new UserApiError(detail, status, {
      type: `https://wallpaperdb.example/problems/${type}`,
    }));
    renderPage();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: /^handle$/i });

    await user.clear(input);
    await user.type(input, 'My draft handle');
    await user.click(screen.getByRole('button', { name: /change handle/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(input).toHaveValue('My draft handle');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the next permitted change time returned by a cooldown rejection', async () => {
    const nextHandleChangeAt = '2099-09-21T12:00:00.000Z';
    vi.mocked(userApi.updateHandle).mockRejectedValue(new UserApiError(
      'You can change your Handle once every seven days.',
      429,
      { type: 'https://wallpaperdb.example/problems/handle-cooldown', nextHandleChangeAt }
    ));
    renderPage();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: /^handle$/i });
    await user.clear(input);
    await user.type(input, 'another-handle');
    await user.click(screen.getByRole('button', { name: /change handle/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('once every seven days');
    expect(screen.getByText(/next handle change available/i)).toHaveTextContent(
      new Date(nextHandleChangeAt).toLocaleString()
    );
    expect(input).toHaveValue('another-handle');
  });

  it('shows the seven-day cooldown from the authoritative Profile before another edit', async () => {
    const lastHandleChangedAt = '2099-09-14T12:00:00.000Z';
    renderPage({ ...profile, lastHandleChangedAt });

    expect(screen.getByText(/next handle change available/i)).toHaveTextContent(
      new Date('2099-09-21T12:00:00.000Z').toLocaleString()
    );
    expect(userApi.updateHandle).not.toHaveBeenCalled();
  });
});
