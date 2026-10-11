import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { ProfileSettingsPage } from '@/components/profile/profile-settings-page';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';

vi.mock('@clerk/react', () => ({ useAuth: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/user', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/user')>();
  return {
    ...original,
    userApi: {
      ensureProfile: vi.fn(),
      updateProfile: vi.fn(),
      updateHandle: vi.fn(),
      scheduleAliasRemoval: vi.fn(),
      expireAlias: vi.fn(),
      reactivateAlias: vi.fn(),
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
    params?: { handle?: string; profileId?: string };
  }) => (
    <a
      href={
        params?.handle
          ? `/profiles/@${params.handle}`
          : params?.profileId
            ? `/profiles/id/${params.profileId}`
            : to
      }
    >
      {children}
    </a>
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
    vi.clearAllMocks();
    vi.mocked(useAuth, { partial: true }).mockReturnValue({
      getToken: vi.fn().mockResolvedValue('token'),
      isLoaded: true,
      isSignedIn: true,
      userId: profile.id,
    });
    vi.mocked(userApi.ensureProfile).mockReset();
    vi.mocked(userApi.updateProfile).mockReset();
    vi.mocked(userApi.updateHandle).mockReset();
    vi.mocked(userApi.scheduleAliasRemoval).mockReset();
    vi.mocked(userApi.expireAlias).mockReset();
    vi.mocked(userApi.reactivateAlias).mockReset();
  });

  it('keeps previous handle details in a dialog behind a compact summary', async () => {
    renderPage({
      ...profile,
      aliases: [{ handle: 'old-name', claimGeneration: 1, expiresAt: null }],
    });
    expect(screen.queryByRole('list', { name: 'Retained aliases' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Previous handles: 1 retained' }));
    const dialog = screen.getByRole('dialog', { name: 'Previous handles' });
    expect(within(dialog).getByRole('list', { name: 'Retained aliases' })).toHaveTextContent(
      '@old-name'
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('returns alias confirmation focus to its specific opener, falling back to the dialog if removed', async () => {
    const aliases = ['first-name', 'second-name'].map((handle, index) => ({ handle, claimGeneration: index + 1 }));
    const { queryClient } = renderPage({ ...profile, aliases });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));
    for (const alias of aliases) {
      const opener = screen.getByRole('button', { name: `Schedule removal for @${alias.handle}` });
      await user.click(opener);
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(opener).toHaveFocus());
    }
    await user.click(screen.getByRole('button', { name: 'Schedule removal for @first-name' }));
    act(() => queryClient.setQueryData(profileQueryKey(profile.id), { ...profile, aliases: [], version: 2 }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Previous handles' })).toHaveFocus());
    expect(userApi.scheduleAliasRemoval).not.toHaveBeenCalled();
  });

  it('shows the current Display name and immediately adopts the REST response', async () => {
    const updated = { ...profile, displayName: 'Éowyn 雪', version: 2 };
    vi.mocked(userApi.updateProfile).mockResolvedValue(updated);
    const { queryClient } = renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit display name' }));

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
    expect(toast.success).toHaveBeenCalledWith('Display name updated');
  });

  it('separates retained and expiring aliases, counting only retained aliases against the configured limit', async () => {
    const expiresAt = '2026-09-16T12:34:56.789Z';
    renderPage({
      ...profile,
      retainedAliasLimit: 2,
      aliases: [
        {
          handle: 'retained-name',
          claimGeneration: 1,
          createdAt: profile.createdAt,
          expiresAt: null,
        },
        { handle: 'expiring-name', claimGeneration: 1, createdAt: profile.createdAt, expiresAt },
      ],
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));

    const retained = screen.getByRole('list', { name: /retained aliases/i });
    const expiring = screen.getByRole('list', { name: /expiring aliases/i });
    expect(within(retained).getByText('@retained-name')).toBeInTheDocument();
    expect(within(retained).queryByText('@expiring-name')).not.toBeInTheDocument();
    expect(within(expiring).getByText('@expiring-name')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 retained aliases')).toBeInTheDocument();
    expect(
      within(expiring)
        .getByText(new Date(expiresAt).toLocaleString(), { exact: false })
        .closest('time')
    ).toHaveAttribute('dateTime', expiresAt);
  });

  it('shows historical eligibility and confirms restoring an available Handle as an alias', async () => {
    const eligibleUntil = '2099-10-15T12:34:56.789Z';
    const claimed = {
      handle: 'claimed-name',
      eligibleUntil: '2099-10-16T12:00:00.000Z',
      unavailableReason: 'claimed' as const,
    };
    const initial: Profile = {
      ...profile,
      lastHandleChangedAt: '2099-09-14T12:00:00.000Z',
      aliases: [],
      historicalHandles: [
        { handle: 'old-handle', eligibleUntil, unavailableReason: null },
        claimed,
      ],
    };
    const updated = {
      ...initial,
      version: 2,
      aliases: [
        {
          handle: 'old-handle',
          claimGeneration: 2,
          createdAt: '2026-09-15T12:00:00.000Z',
          expiresAt: null,
        },
      ],
      historicalHandles: [claimed],
    };
    vi.mocked(userApi.reactivateAlias).mockResolvedValue(updated);
    const { queryClient } = renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));
    const history = screen.getByRole('list', { name: 'Historical Handles' });
    expect(within(history).getByText(new Date(eligibleUntil).toLocaleString())).toHaveAttribute(
      'dateTime',
      eligibleUntil
    );
    expect(
      within(history).getByRole('button', { name: 'Reactivate @claimed-name' })
    ).toBeDisabled();
    expect(
      within(history).getByText('Another Profile has claimed this Handle.')
    ).toBeInTheDocument();
    await user.click(within(history).getByRole('button', { name: 'Reactivate @old-handle' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('retained alias slot');
    expect(dialog).toHaveTextContent(`Your current Handle will stay @${profile.handle}`);
    expect(userApi.reactivateAlias).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Reactivate alias' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      '@old-handle is now a retained alias.'
    );
    expect(userApi.reactivateAlias).toHaveBeenCalledWith({
      handle: 'old-handle',
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    expect(
      within(screen.getByRole('dialog', { name: 'Previous handles' })).getByText(
        `@${profile.handle}`
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Retained aliases' })).getByText('@old-handle')
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Historical Handles' })).queryByText('@old-handle')
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Available for change in/).querySelector('time')).toHaveAttribute(
      'datetime',
      '2099-09-21T12:00:00.000Z'
    );
  });

  it('keeps an eligible expiring alias by confirming cancellation of its scheduled removal', async () => {
    const alias = {
      handle: 'old-handle',
      claimGeneration: 2,
      createdAt: profile.createdAt,
      expiresAt: '2099-09-16T12:00:00.000Z',
    };
    const eligibleUntil = '2099-10-15T12:00:00.000Z';
    const initial: Profile = {
      ...profile,
      lastHandleChangedAt: '2099-09-14T12:00:00.000Z',
      aliases: [alias],
      historicalHandles: [{ handle: alias.handle, eligibleUntil, unavailableReason: null }],
    };
    const updated = {
      ...initial,
      version: 2,
      aliases: [{ ...alias, expiresAt: null }],
      historicalHandles: [],
    };
    vi.mocked(userApi.reactivateAlias).mockResolvedValue(updated);
    const { queryClient } = renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));
    const expiring = screen.getByRole('list', { name: 'Expiring aliases' });
    expect(within(expiring).getByText(new Date(eligibleUntil).toLocaleString())).toHaveAttribute(
      'dateTime',
      eligibleUntil
    );
    expect(screen.getAllByText('@old-handle')).toHaveLength(1);
    expect(screen.queryByRole('list', { name: 'Historical Handles' })).not.toBeInTheDocument();
    await user.click(within(expiring).getByRole('button', { name: 'Keep alias @old-handle' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Cancel the scheduled removal of @old-handle');
    expect(dialog).toHaveTextContent('keep redirecting');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(userApi.reactivateAlias).not.toHaveBeenCalled();
    await user.click(within(expiring).getByRole('button', { name: 'Keep alias @old-handle' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep alias' })
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Scheduled removal canceled for @old-handle.'
    );
    expect(userApi.reactivateAlias).toHaveBeenCalledWith({
      handle: alias.handle,
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    expect(screen.queryByRole('list', { name: 'Expiring aliases' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Retained aliases' })).getByText('@old-handle')
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog', { name: 'Previous handles' })).getByText(
        `@${profile.handle}`
      )
    ).toBeInTheDocument();
  });

  it('disables both alias restoration actions and explains when no retained slot is available', async () => {
    renderPage({
      ...profile,
      retainedAliasLimit: 0,
      aliases: [
        {
          handle: 'expiring-name',
          claimGeneration: 1,
          createdAt: profile.createdAt,
          expiresAt: '2099-09-16T12:00:00.000Z',
        },
      ],
      historicalHandles: ['expiring-name', 'released-name'].map((handle) => ({
        handle,
        eligibleUntil: '2099-10-15T12:00:00.000Z',
        unavailableReason: 'alias-limit' as const,
      })),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));
    const keep = screen.getByRole('button', { name: 'Keep alias @expiring-name' });
    const reactivate = screen.getByRole('button', { name: 'Reactivate @released-name' });
    expect(keep).toBeDisabled();
    expect(reactivate).toBeDisabled();
    expect(screen.getAllByText('Your retained-alias limit is full.')).toHaveLength(2);
    await user.click(keep);
    await user.click(reactivate);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(userApi.reactivateAlias).not.toHaveBeenCalled();
  });

  it('disables stale history entries whose reactivation deadline has passed', async () => {
    renderPage({
      ...profile,
      aliases: [
        {
          handle: 'expiring-name',
          claimGeneration: 1,
          createdAt: profile.createdAt,
          expiresAt: '2099-09-16T12:00:00.000Z',
        },
      ],
      historicalHandles: ['expiring-name', 'released-name'].map((handle) => ({
        handle,
        eligibleUntil: '2000-01-01T12:00:00.000Z',
        unavailableReason: null,
      })),
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));

    expect(screen.getByRole('button', { name: 'Keep alias @expiring-name' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reactivate @released-name' })).toBeDisabled();
    expect(
      screen.getAllByText('This Handle is no longer in your recent history. Refresh aliases.')
    ).toHaveLength(2);
    expect(userApi.reactivateAlias).not.toHaveBeenCalled();
  });

  it('preserves the confirmed version after a reactivation conflict and refreshes eligibility', async () => {
    const initial: Profile = {
      ...profile,
      aliases: [],
      historicalHandles: [
        {
          handle: 'old-handle',
          eligibleUntil: '2099-10-15T12:00:00.000Z',
          unavailableReason: null,
        },
      ],
    };
    const changed = { ...initial, version: 2 };
    const refreshed: Profile = {
      ...changed,
      historicalHandles: [
        {
          handle: 'old-handle',
          eligibleUntil: '2099-10-15T12:00:00.000Z',
          unavailableReason: 'claimed',
        },
      ],
    };
    vi.mocked(userApi.reactivateAlias).mockRejectedValue(
      new UserApiError('Profile changed.', 409, {
        type: 'https://wallpaperdb.example/problems/profile-version-conflict',
      })
    );
    vi.mocked(userApi.ensureProfile).mockResolvedValue(refreshed);
    const { queryClient } = renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));
    await user.click(screen.getByRole('button', { name: 'Reactivate @old-handle' }));
    await act(async () => {
      queryClient.setQueryData(profileQueryKey(profile.id), changed);
    });
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reactivate alias' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your Profile changed elsewhere. Refresh aliases before reactivating again.'
    );
    expect(userApi.reactivateAlias).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 1 })
    );
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(changed);
    expect(screen.queryByRole('list', { name: 'Retained aliases' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh aliases' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reactivate @old-handle' })).toBeDisabled()
    );
    expect(screen.getByText('Another Profile has claimed this Handle.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(refreshed);
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
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));

    await user.click(screen.getByRole('button', { name: 'Schedule removal for @old-handle' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('@old-handle');
    expect(dialog).toHaveTextContent('24 hours');
    expect(dialog).toHaveTextContent('redirect until it expires');
    expect(userApi.scheduleAliasRemoval).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(userApi.scheduleAliasRemoval).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Schedule removal for @old-handle' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Schedule removal' })
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Removal scheduled for @old-handle.'
    );
    expect(userApi.scheduleAliasRemoval).toHaveBeenCalledWith({
      handle: 'old-handle',
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    const expiring = screen.getByRole('list', { name: /expiring aliases/i });
    expect(
      within(expiring).getByText(new Date(expiresAt).toLocaleString()).closest('time')
    ).toHaveAttribute('dateTime', expiresAt);
    expect(
      within(expiring).queryByRole('button', { name: /schedule removal/i })
    ).not.toBeInTheDocument();
    expect(screen.getByText('0 of 3 retained aliases')).toBeInTheDocument();
  });

  it('keeps a retained alias and explains when scheduling loses an optimistic concurrency race', async () => {
    const initial = {
      ...profile,
      aliases: [
        { handle: 'old-handle', claimGeneration: 1, createdAt: profile.createdAt, expiresAt: null },
      ],
    };
    vi.mocked(userApi.scheduleAliasRemoval).mockRejectedValue(
      new UserApiError('Profile has changed.', 409, {
        type: 'https://wallpaperdb.example/problems/profile-version-conflict',
      })
    );
    const { queryClient } = renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));

    await user.click(screen.getByRole('button', { name: 'Schedule removal for @old-handle' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Schedule removal' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your Profile changed elsewhere. Refresh aliases before scheduling again.'
    );
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(initial);
    expect(
      within(screen.getByRole('list', { name: /retained aliases/i })).getByText('@old-handle')
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('confirms immediate expiry before removing an expiring alias from authoritative owner state', async () => {
    const retained = {
      handle: 'retained-name',
      claimGeneration: 1,
      createdAt: profile.createdAt,
      expiresAt: null,
    };
    const initial = {
      ...profile,
      aliases: [
        retained,
        {
          handle: 'old-handle',
          claimGeneration: 1,
          createdAt: profile.createdAt,
          expiresAt: '2099-09-16T12:00:00.000Z',
        },
      ],
    };
    const updated = { ...initial, version: 2, aliases: [retained] };
    vi.mocked(userApi.expireAlias).mockResolvedValue(updated);
    const { queryClient } = renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));

    expect(
      within(screen.getByRole('list', { name: 'Retained aliases' })).queryByRole('button', {
        name: /expire/i,
      })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expire @old-handle now' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('@old-handle');
    expect(dialog).toHaveTextContent('stop redirecting immediately');
    expect(dialog).toHaveTextContent('available for another User to claim');
    expect(userApi.expireAlias).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(userApi.expireAlias).not.toHaveBeenCalled();
    expect(screen.getByText('@old-handle')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expire @old-handle now' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Expire now' })
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      '@old-handle has expired and no longer redirects to your Profile.'
    );
    expect(userApi.expireAlias).toHaveBeenCalledWith({
      handle: 'old-handle',
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    expect(screen.queryByRole('list', { name: 'Expiring aliases' })).not.toBeInTheDocument();
    expect(screen.getByText('@retained-name')).toBeInTheDocument();
  });

  it('preserves the confirmed version and explains an expiry conflict without removing the alias locally', async () => {
    const initial = {
      ...profile,
      aliases: [
        {
          handle: 'old-handle',
          claimGeneration: 1,
          createdAt: profile.createdAt,
          expiresAt: '2099-09-16T12:00:00.000Z',
        },
      ],
    };
    const refreshed = { ...initial, version: 2 };
    vi.mocked(userApi.expireAlias).mockRejectedValue(
      new UserApiError('Profile changed.', 409, {
        type: 'https://wallpaperdb.example/problems/profile-version-conflict',
      })
    );
    const { queryClient } = renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));
    await user.click(screen.getByRole('button', { name: 'Expire @old-handle now' }));
    await act(async () => {
      queryClient.setQueryData(profileQueryKey(profile.id), refreshed);
    });
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Expire now' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your Profile changed elsewhere. Refresh aliases before expiring again.'
    );
    expect(userApi.expireAlias).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 1 })
    );
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(refreshed);
    expect(
      within(screen.getByRole('list', { name: 'Expiring aliases' })).getByText('@old-handle')
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('refreshes owner state to remove aliases that expired automatically', async () => {
    const initial = {
      ...profile,
      aliases: [
        {
          handle: 'old-handle',
          claimGeneration: 1,
          createdAt: profile.createdAt,
          expiresAt: '2026-09-01T12:00:00.000Z',
        },
      ],
    };
    const updated = { ...profile, version: 2, aliases: [] };
    vi.mocked(userApi.ensureProfile).mockResolvedValue(updated);
    const { queryClient } = renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));

    expect(screen.getByText('@old-handle')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh aliases' }));

    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Expiring aliases' })).not.toBeInTheDocument()
    );
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    expect(userApi.ensureProfile).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(userApi.expireAlias).not.toHaveBeenCalled();
  });

  it('prevents alias refreshes and Profile writes from overwriting each other', async () => {
    const initial = {
      ...profile,
      aliases: [
        {
          handle: 'retained-name',
          claimGeneration: 1,
          createdAt: profile.createdAt,
          expiresAt: null,
        },
        {
          handle: 'old-handle',
          claimGeneration: 1,
          createdAt: profile.createdAt,
          expiresAt: '2099-09-16T12:00:00.000Z',
        },
      ],
    };
    let finishRefresh!: (value: Profile) => void;
    let finishExpiry!: (value: Profile) => void;
    vi.mocked(userApi.ensureProfile).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        })
    );
    vi.mocked(userApi.expireAlias).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishExpiry = resolve;
        })
    );
    const { queryClient } = renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit display name' }));
    await user.type(screen.getByRole('textbox', { name: 'Display name' }), ' draft');
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    await user.type(screen.getByRole('textbox', { name: 'Profile handle' }), '-draft');
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));
    await user.click(screen.getByRole('button', { name: 'Refresh aliases' }));

    await waitFor(() => expect(userApi.ensureProfile).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Expire @old-handle now' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Schedule removal for @retained-name' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Save profile handle', hidden: true })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save display name', hidden: true })).toBeDisabled();
    await act(async () => {
      finishRefresh({ ...initial, version: 2 });
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Save profile handle', hidden: true })
      ).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Save display name', hidden: true })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Expire @old-handle now' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Expire now' })
    );
    await waitFor(() => expect(userApi.expireAlias).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Refresh aliases' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh aliases' }));
    expect(userApi.ensureProfile).toHaveBeenCalledOnce();
    const updated = {
      ...initial,
      version: 3,
      aliases: initial.aliases.filter((alias) => alias.handle !== 'old-handle'),
    };
    await act(async () => {
      finishExpiry(updated);
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh aliases' })).toBeEnabled()
    );
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
  });

  it('preserves unsaved identity drafts when refreshing aliases loads changes from another session', async () => {
    const updated = {
      ...profile,
      displayName: 'Remote name',
      handle: 'remote-handle',
      version: 2,
      aliases: [],
    };
    vi.mocked(userApi.ensureProfile).mockResolvedValue(updated);
    const { queryClient } = renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    await user.click(screen.getByRole('button', { name: 'Edit display name' }));
    const nameInput = screen.getByRole('textbox', { name: 'Display name' });
    const handleInput = screen.getByRole('textbox', { name: 'Profile handle' });
    await user.clear(nameInput);
    await user.type(nameInput, 'My name draft');
    await user.clear(handleInput);
    await user.type(handleInput, 'my-handle-draft');
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));
    await user.click(screen.getByRole('button', { name: 'Refresh aliases' }));

    await waitFor(() =>
      expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(updated)
    );
    expect(nameInput).toHaveValue('My name draft');
    expect(handleInput).toHaveValue('my-handle-draft');
    expect(userApi.updateProfile).not.toHaveBeenCalled();
    expect(userApi.updateHandle).not.toHaveBeenCalled();
  });

  it('resets identity drafts when another signed-in User opens their cached Profile', async () => {
    const otherProfile = {
      ...profile,
      id: 'user_456',
      displayName: 'Another User',
      handle: 'another-user',
    };
    const { queryClient, rerender } = renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    await user.click(screen.getByRole('button', { name: 'Edit display name' }));
    await user.clear(screen.getByRole('textbox', { name: 'Display name' }));
    await user.type(screen.getByRole('textbox', { name: 'Display name' }), 'First User draft');
    await user.clear(screen.getByRole('textbox', { name: 'Profile handle' }));
    await user.type(screen.getByRole('textbox', { name: 'Profile handle' }), 'first-user-draft');
    const auth = vi.mocked(useAuth)();
    if (!auth.isLoaded || !auth.isSignedIn) throw new Error('Expected a signed-in test User');
    vi.mocked(useAuth, { partial: true }).mockReturnValue({ ...auth, userId: otherProfile.id });
    queryClient.setQueryData(profileQueryKey(otherProfile.id), otherProfile);
    rerender(
      <QueryClientProvider client={queryClient}>
        <ProfileSettingsPage />
      </QueryClientProvider>
    );

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: otherProfile.displayName })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit display name' }));
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue(
      otherProfile.displayName
    );
    expect(screen.getByRole('textbox', { name: 'Profile handle' })).toHaveValue(
      otherProfile.handle
    );
    expect(userApi.updateProfile).not.toHaveBeenCalled();
    expect(userApi.updateHandle).not.toHaveBeenCalled();
  });

  it('retains unsaved input and explains a stale edit', async () => {
    vi.mocked(userApi.updateProfile).mockRejectedValue(
      new UserApiError('Profile has changed since it was last loaded', 409, {
        type: 'https://wallpaperdb.example/problems/profile-version-conflict',
      })
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit display name' }));
    const input = screen.getByRole('textbox', { name: /display name/i });

    await user.clear(input);
    await user.type(input, 'My unsaved name');
    await user.click(screen.getByRole('button', { name: /save display name/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your profile changed elsewhere. Refresh profile to keep your draft and try again.'
    );
    expect(input).toHaveValue('My unsaved name');
  });

  it('changes the handle and previews the authoritative profile with a public link', async () => {
    const updated = { ...profile, handle: 'new-handle', version: 2 };
    vi.mocked(userApi.updateHandle).mockResolvedValue(updated);
    const { queryClient } = renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: /^profile handle$/i });

    expect(input).toHaveValue(profile.handle);
    await user.clear(input);
    await user.type(input, 'New Handle');
    await user.click(screen.getByRole('button', { name: /save profile handle/i }));

    await waitFor(() => expect(input).toHaveValue('new-handle'));
    expect(queryClient.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    expect(userApi.updateHandle).toHaveBeenCalledWith({
      handle: 'New Handle',
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(toast.success).toHaveBeenCalledWith('Profile handle updated');
    await user.click(screen.getByRole('button', { name: 'View profile' }));
    const preview = screen.getByRole('dialog', { name: 'Profile preview' });
    expect(within(preview).getByText('@new-handle')).toBeInTheDocument();
    expect(within(preview).getByRole('link', { name: /open your profile/i })).toHaveAttribute(
      'href',
      `/profiles/id/${profile.id}`
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
        ...aliases.map((alias) => ({
          ...alias,
          expiresAt: alias.handle === 'oldest' ? expiresAt : null,
        })),
        {
          handle: profile.handle,
          claimGeneration: 1,
          createdAt: '2026-09-15T15:01:02.345Z',
          expiresAt: null,
        },
      ],
    };
    vi.mocked(userApi.updateHandle).mockResolvedValue(updated);
    renderPage({ ...profile, aliases });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: /^profile handle$/i });

    await user.clear(input);
    await user.type(input, 'New Handle');
    await user.click(screen.getByRole('button', { name: 'Save profile handle' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('@oldest');
    expect(dialog).not.toHaveTextContent('@middle');
    expect(dialog).toHaveTextContent('24 hours');
    expect(userApi.updateHandle).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(userApi.updateHandle).not.toHaveBeenCalled();
    expect(input).toHaveValue('New Handle');
    await user.click(screen.getByRole('button', { name: 'Save profile handle' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm handle change' })
    );

    await waitFor(() => expect(input).toHaveValue('new-handle'));
    expect(userApi.updateHandle).toHaveBeenCalledWith({
      handle: 'New Handle',
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));
    const expiring = screen.getByRole('list', { name: /expiring aliases/i });
    expect(within(expiring).getByText('@oldest')).toBeInTheDocument();
    expect(within(expiring).getByText(new Date(expiresAt).toLocaleString())).toHaveAttribute(
      'dateTime',
      expiresAt
    );
  });

  it('promotes a normalized retained alias at capacity without warning about an expiry that will not occur', async () => {
    const aliases = ['oldest', 'my-alias', 'newest'].map((handle, index) => ({
      handle,
      claimGeneration: 1,
      createdAt: `2026-09-0${index + 1}T12:00:00.000Z`,
      expiresAt: null,
    }));
    vi.mocked(userApi.updateHandle).mockResolvedValue({
      ...profile,
      handle: 'my-alias',
      version: 2,
    });
    renderPage({ ...profile, aliases });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: /^profile handle$/i });

    await user.clear(input);
    await user.type(input, 'Mý Alias');
    await user.click(screen.getByRole('button', { name: 'Save profile handle' }));

    await waitFor(() => expect(userApi.updateHandle).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(input).toHaveValue('my-alias');
  });

  it('warns that the former current Handle will expire when the retained limit is zero', async () => {
    renderPage({ ...profile, retainedAliasLimit: 0, aliases: [] });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: /^profile handle$/i });
    await user.clear(input);
    await user.type(input, 'new-handle');
    await user.click(screen.getByRole('button', { name: 'Save profile handle' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('limit is 0');
    expect(dialog).toHaveTextContent(`@${profile.handle}`);
    expect(dialog).toHaveTextContent('24 hours');
    expect(userApi.updateHandle).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: /^Previous handles:/ }));
    expect(screen.getByText('0 of 0 retained aliases')).toBeInTheDocument();
  });

  it('names every retained alias affected by a lowered limit and excludes aliases already expiring', async () => {
    renderPage({
      ...profile,
      retainedAliasLimit: 1,
      aliases: [
        {
          handle: 'already-expiring',
          claimGeneration: 1,
          createdAt: profile.createdAt,
          expiresAt: '2026-09-16T12:00:00.000Z',
        },
        { handle: 'oldest', claimGeneration: 1, createdAt: profile.createdAt, expiresAt: null },
        { handle: 'newest', claimGeneration: 1, createdAt: profile.createdAt, expiresAt: null },
      ],
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: /^profile handle$/i });
    await user.clear(input);
    await user.type(input, 'new-handle');
    await user.click(screen.getByRole('button', { name: 'Save profile handle' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('limit is 1');
    expect(dialog).toHaveTextContent('@oldest, @newest');
    expect(dialog).not.toHaveTextContent('@already-expiring');
    expect(dialog).not.toHaveTextContent(`@${profile.handle}`);
    expect(userApi.updateHandle).not.toHaveBeenCalled();
  });

  it('submits a normalized current Handle without a capacity warning', async () => {
    const initial = {
      ...profile,
      aliases: ['oldest', 'middle', 'newest'].map((handle) => ({
        handle,
        claimGeneration: 1,
        createdAt: profile.createdAt,
        expiresAt: null,
      })),
    };
    vi.mocked(userApi.updateHandle).mockResolvedValue(initial);
    renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: /^profile handle$/i });
    await user.clear(input);
    await user.type(input, 'Wallpaper Fan');
    await user.click(screen.getByRole('button', { name: 'Save profile handle' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Profile handle unchanged'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(userApi.updateHandle).toHaveBeenCalledOnce();
  });

  it('confirms the version shown in the capacity warning even if Profile state changes while it is open', async () => {
    const initial = { ...profile, retainedAliasLimit: 0, aliases: [] };
    vi.mocked(userApi.updateHandle).mockRejectedValue(
      new UserApiError('Profile changed.', 409, {
        type: 'https://wallpaperdb.example/problems/profile-version-conflict',
      })
    );
    const { queryClient } = renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: /^profile handle$/i });
    await user.clear(input);
    await user.type(input, 'new-handle');
    await user.click(screen.getByRole('button', { name: 'Save profile handle' }));

    await act(async () => {
      queryClient.setQueryData(profileQueryKey(profile.id), { ...initial, version: 2 });
    });
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm handle change' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Your profile changed elsewhere.');
    expect(userApi.updateHandle).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 1 })
    );
    expect(input).toHaveValue('new-handle');
  });

  it('validates the 80-character limit before sending', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit display name' }));
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
      'Your profile changed elsewhere. Refresh profile to keep your draft and try again.',
    ],
  ])('preserves the Handle draft and explains %s', async (type, status, detail, expected) => {
    vi.mocked(userApi.updateHandle).mockRejectedValue(
      new UserApiError(detail, status, {
        type: `https://wallpaperdb.example/problems/${type}`,
      })
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: /^profile handle$/i });

    await user.clear(input);
    await user.type(input, 'My draft handle');
    await user.click(screen.getByRole('button', { name: /save profile handle/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(input).toHaveValue('My draft handle');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Profile handle save failed');
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Unable to save profile handle', {
      description: detail,
    });
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
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: /^profile handle$/i });
    await user.clear(input);
    await user.type(input, 'another-handle');
    await user.click(screen.getByRole('button', { name: /save profile handle/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('once every seven days');
    expect(screen.getByText(/Available for change in/).querySelector('time')).toHaveAttribute(
      'datetime',
      nextHandleChangeAt
    );
    expect(input).toHaveValue('another-handle');
  });

  it('shows the seven-day cooldown from the authoritative Profile before another edit', async () => {
    const lastHandleChangedAt = '2099-09-14T12:00:00.000Z';
    renderPage({ ...profile, lastHandleChangedAt });

    expect(screen.getByText(/Available for change in/).querySelector('time')).toHaveAttribute(
      'datetime',
      '2099-09-21T12:00:00.000Z'
    );
    expect(screen.getByRole('button', { name: 'Edit profile handle' })).toBeDisabled();
    const user = userEvent.setup();
    await user.hover(screen.getByRole('button', { name: /days$/ }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      new Date('2099-09-21T12:00:00.000Z').toLocaleString(undefined, {
        dateStyle: 'full',
        timeStyle: 'long',
      })
    );
    expect(userApi.updateHandle).not.toHaveBeenCalled();
  });

  it('reports an unchanged normalized Handle without claiming the address changed', async () => {
    vi.mocked(userApi.updateHandle).mockResolvedValue(profile);
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: /^profile handle$/i });
    await user.clear(input);
    await user.type(input, 'Wallpaper Fan');
    await user.click(screen.getByRole('button', { name: /save profile handle/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Profile handle unchanged'));
    expect(input).toHaveValue(profile.handle);
    expect(toast.success).not.toHaveBeenCalledWith('Profile handle updated');
  });
});
