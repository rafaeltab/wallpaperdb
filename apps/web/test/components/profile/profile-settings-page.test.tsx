import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    userApi: {
      ensureProfile: vi.fn(),
      updateProfile: vi.fn(),
      updateHandle: vi.fn(),
      scheduleAliasRemoval: vi.fn(),
    },
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: { handle: string };
  }) => <a href={params ? `/profiles/@${params.handle}` : to}>{children}</a>,
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
    vi.mocked(userApi.scheduleAliasRemoval).mockReset();
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

  it('separates retained and expiring aliases, counting only retained aliases against the configured limit', () => {
    const expiresAt = '2026-09-16T12:34:56.789Z';
    renderPage({
      ...profile,
      retainedAliasLimit: 2,
      aliases: [
        { handle: 'retained-name', claimGeneration: 1, createdAt: profile.createdAt, expiresAt: null },
        { handle: 'expiring-name', claimGeneration: 1, createdAt: profile.createdAt, expiresAt },
      ],
    });

    const retained = screen.getByRole('list', { name: /retained aliases/i });
    const expiring = screen.getByRole('list', { name: /expiring aliases/i });
    expect(within(retained).getByText('@retained-name')).toBeInTheDocument();
    expect(within(retained).queryByText('@expiring-name')).not.toBeInTheDocument();
    expect(within(expiring).getByText('@expiring-name')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 retained aliases')).toBeInTheDocument();
    expect(within(expiring).getByText(new Date(expiresAt).toLocaleString(), { exact: false }).closest('time')).toHaveAttribute('dateTime', expiresAt);
  });

  it('requires confirmation before scheduling an alias and adopts the server expiry immediately', async () => {
    const alias = {
      handle: 'old-handle',
      claimGeneration: 1,
      createdAt: profile.createdAt,
      expiresAt: null,
    };
    const expiresAt = '2026-09-16T14:35:26.789Z';
    const updated = { ...profile, version: 2, aliases: [{ ...alias, expiresAt }] };
    vi.mocked(userApi.scheduleAliasRemoval).mockResolvedValue(updated);
    const { queryClient } = renderPage({ ...profile, aliases: [alias] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Schedule removal for @old-handle' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('@old-handle');
    expect(dialog).toHaveTextContent('24 hours');
    expect(dialog).toHaveTextContent('redirect until it expires');
    expect(userApi.scheduleAliasRemoval).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(userApi.scheduleAliasRemoval).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Schedule removal for @old-handle' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Schedule removal' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Removal scheduled for @old-handle.');
    expect(userApi.scheduleAliasRemoval).toHaveBeenCalledWith({
      handle: 'old-handle',
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    const expiring = screen.getByRole('list', { name: /expiring aliases/i });
    expect(within(expiring).getByText(new Date(expiresAt).toLocaleString()).closest('time')).toHaveAttribute('dateTime', expiresAt);
    expect(within(expiring).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('0 of 3 retained aliases')).toBeInTheDocument();
  });

  it('keeps a retained alias and explains when scheduling loses an optimistic concurrency race', async () => {
    const initial = {
      ...profile,
      aliases: [{ handle: 'old-handle', claimGeneration: 1, createdAt: profile.createdAt, expiresAt: null }],
    };
    vi.mocked(userApi.scheduleAliasRemoval).mockRejectedValue(
      new UserApiError('Profile has changed.', 409, {
        type: 'https://wallpaperdb.example/problems/profile-version-conflict',
      })
    );
    const { queryClient } = renderPage(initial);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Schedule removal for @old-handle' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Schedule removal' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your Profile changed elsewhere. Reload before scheduling again.'
    );
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(initial);
    expect(within(screen.getByRole('list', { name: /retained aliases/i })).getByText('@old-handle')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your previous Profile address will redirect to your new one.'
    );
    expect(screen.getByRole('link', { name: /view your profile/i })).toHaveAttribute(
      'href',
      '/profiles/@new-handle'
    );
  });

  it('warns which oldest retained alias will expire before confirming a Handle change at capacity', async () => {
    const aliases = ['oldest', 'middle', 'newest'].map((handle, index) => ({
      handle,
      claimGeneration: 1,
      createdAt: `2026-09-0${index + 1}T12:00:00.000Z`,
      expiresAt: null,
    }));
    const expiresAt = '2026-09-16T15:01:02.345Z';
    const updated = {
      ...profile,
      handle: 'new-handle',
      version: 2,
      aliases: [
        ...aliases.map((alias) => ({ ...alias, expiresAt: alias.handle === 'oldest' ? expiresAt : null })),
        { handle: profile.handle, claimGeneration: 1, createdAt: '2026-09-15T15:01:02.345Z', expiresAt: null },
      ],
    };
    vi.mocked(userApi.updateHandle).mockResolvedValue(updated);
    renderPage({ ...profile, aliases });
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: /^handle$/i });

    await user.clear(input);
    await user.type(input, 'New Handle');
    await user.click(screen.getByRole('button', { name: 'Change Handle' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('@oldest');
    expect(dialog).not.toHaveTextContent('@middle');
    expect(dialog).toHaveTextContent('24 hours');
    expect(userApi.updateHandle).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(userApi.updateHandle).not.toHaveBeenCalled();
    expect(input).toHaveValue('New Handle');
    await user.click(screen.getByRole('button', { name: 'Change Handle' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm Handle change' }));

    await waitFor(() => expect(input).toHaveValue('new-handle'));
    expect(userApi.updateHandle).toHaveBeenCalledWith({
      handle: 'New Handle',
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    const expiring = screen.getByRole('list', { name: /expiring aliases/i });
    expect(within(expiring).getByText('@oldest')).toBeInTheDocument();
    expect(within(expiring).getByText(new Date(expiresAt).toLocaleString())).toHaveAttribute('dateTime', expiresAt);
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
    [
      'invalid-handle',
      400,
      'Handle must contain between 1 and 30 characters.',
      'Handle must contain between 1 and 30 characters.',
    ],
    ['handle-unavailable', 409, 'That Handle is already in use.', 'That Handle is already in use.'],
    [
      'profile-version-conflict',
      409,
      'Profile has changed.',
      'Your Profile changed elsewhere. Reload before saving again.',
    ],
  ])('preserves the Handle draft and explains %s', async (type, status, detail, expected) => {
    vi.mocked(userApi.updateHandle).mockRejectedValue(
      new UserApiError(detail, status, {
        type: `https://wallpaperdb.example/problems/${type}`,
      })
    );
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
    vi.mocked(userApi.updateHandle).mockRejectedValue(
      new UserApiError('You can change your Handle once every seven days.', 429, {
        type: 'https://wallpaperdb.example/problems/handle-cooldown',
        nextHandleChangeAt,
      })
    );
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

  it('reports an unchanged normalized Handle without claiming the address changed', async () => {
    vi.mocked(userApi.updateHandle).mockResolvedValue(profile);
    renderPage();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: /^handle$/i });
    await user.clear(input);
    await user.type(input, 'Wallpaper Fan');
    await user.click(screen.getByRole('button', { name: /change handle/i }));

    expect(await screen.findByRole('status')).toHaveTextContent('Handle unchanged.');
    expect(input).toHaveValue(profile.handle);
    expect(screen.getByRole('status')).not.toHaveTextContent('Handle changed');
  });
});
