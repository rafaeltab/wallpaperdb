import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { ProfileSettingsPage } from '@/components/profile/profile-settings-page';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';
import { request } from '@/lib/graphql/client';

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

describe('Biography settings', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.mocked(request).mockReset().mockResolvedValue({ getWallpaper: null });
    vi.mocked(useAuth, { partial: true }).mockReturnValue({
      getToken: vi.fn().mockResolvedValue('token'),
      isLoaded: true,
      isSignedIn: true,
      userId: profile.id,
    });
    vi.mocked(userApi.ensureProfile).mockReset();
    vi.mocked(userApi.updateProfile).mockReset();
  });

  it('refreshes an exhausted same-Markdown wallpaper embed when the owner deliberately refreshes Biography', async () => {
    vi.useFakeTimers();
    const initial = { ...profile, biographyMarkdown: '![Forest](wallpaper:wlpr_own)' };
    vi.mocked(userApi.ensureProfile).mockResolvedValue(initial);
    renderPage(initial);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    for (const delay of [1000, 2000, 4000])
      await act(async () => vi.advanceTimersByTimeAsync(delay));
    expect(request).toHaveBeenCalledTimes(4);
    vi.mocked(request).mockResolvedValue({
      getWallpaper: {
        wallpaperId: 'wlpr_own',
        profileId: profile.id,
        uploadedAt: '',
        updatedAt: '',
        variants: [
          {
            width: 800,
            height: 600,
            aspectRatio: 4 / 3,
            format: 'image/webp',
            fileSizeBytes: 100,
            createdAt: '',
            url: '/media/own.webp',
          },
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Biography' }));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('img', { name: 'Forest' })).toHaveAttribute('src', '/media/own.webp');
    expect(request).toHaveBeenCalledTimes(5);
  });

  it('blocks owner refresh during a Biography write and keeps the accepted state when refresh fails', async () => {
    let finishSave: ((value: Profile) => void) | undefined;
    vi.mocked(userApi.updateProfile).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        })
    );
    vi.mocked(userApi.ensureProfile).mockRejectedValue(new Error('Offline'));
    const { client } = renderPage();
    const user = userEvent.setup();
    const editor = screen.getByRole('textbox', { name: 'Biography Markdown' });
    await user.clear(editor);
    await user.type(editor, 'Saved Biography');
    await user.click(screen.getByRole('button', { name: 'Save Biography' }));
    expect(screen.getByRole('button', { name: 'Refresh Biography' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh Profile' })).toBeDisabled();
    expect(editor).toBeDisabled();
    expect(userApi.ensureProfile).not.toHaveBeenCalled();
    const updated = { ...profile, biographyMarkdown: 'Saved Biography', version: 2 };
    await act(async () => finishSave?.(updated));
    await user.click(screen.getByRole('button', { name: 'Refresh Biography' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to refresh Biography. Try again.'
    );
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    expect(editor).toHaveValue('Saved Biography');
  });

  it('preserves a wallpaper Biography draft while the server ownership projection catches up', async () => {
    const biographyMarkdown = '![New wallpaper](wallpaper:wlpr_new)';
    vi.mocked(userApi.updateProfile).mockRejectedValueOnce(
      new UserApiError(
        'Wallpaper is not available yet. Newly published wallpapers may take a moment; try again.',
        400,
        { type: 'https://wallpaperdb.test/problems/unavailable-wallpaper' }
      )
    );
    const updated = { ...profile, biographyMarkdown, version: 2 };
    vi.mocked(userApi.updateProfile).mockResolvedValueOnce(updated);
    const { client } = renderPage();
    const user = userEvent.setup();
    const editor = screen.getByRole('textbox', { name: 'Biography Markdown' });
    await user.clear(editor);
    fireEvent.change(editor, { target: { value: biographyMarkdown } });
    expect(editor).toHaveValue(biographyMarkdown);
    await user.click(screen.getByRole('button', { name: 'Save Biography' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Newly published wallpapers may take a moment; try again.'
    );
    expect(editor).toHaveValue(biographyMarkdown);
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(profile);
    await user.click(screen.getByRole('button', { name: 'Save Biography' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
  });

  it('previews the draft through the shared safe renderer and shows an empty Biography state', async () => {
    renderPage({ ...profile, biographyMarkdown: '', biographyMaxLength: 6000 });
    const user = userEvent.setup();
    const preview = screen.getByRole('region', { name: 'Biography preview' });
    expect(within(preview).getByText('No biography yet.')).toBeInTheDocument();
    const editor = screen.getByRole('textbox', { name: 'Biography Markdown' });
    await user.type(editor, '**Wallpaper collector**');
    expect(within(preview).getByText('Wallpaper collector').tagName).toBe('STRONG');
    await user.clear(editor);
    await user.type(editor, '<script>alert(1)</script>');
    expect(
      within(preview).getByText('This Biography cannot be displayed safely.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Biography' })).toBeDisabled();
    expect(userApi.updateProfile).not.toHaveBeenCalled();
  });

  it('keeps an unchanged Biography unsavable and adopts fresh text while the editor is pristine', async () => {
    const { client } = renderPage();
    expect(screen.getByRole('button', { name: 'Save Biography' })).toBeDisabled();
    act(() =>
      client.setQueryData(profileQueryKey(profile.id), {
        ...profile,
        biographyMarkdown: 'Fresh Biography',
        version: 2,
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Biography Markdown' })).toHaveValue(
        'Fresh Biography'
      )
    );
    expect(screen.getByRole('button', { name: 'Save Biography' })).toBeDisabled();
    expect(userApi.updateProfile).not.toHaveBeenCalled();
  });

  it('keeps an edit based on its original version until the author deliberately refreshes after a conflict', async () => {
    vi.mocked(userApi.updateProfile).mockRejectedValueOnce(
      new UserApiError('Conflict', 409, {
        type: 'https://wallpaperdb.test/problems/profile-version-conflict',
      })
    );
    const remote = { ...profile, biographyMarkdown: 'Remote Biography', version: 2 };
    vi.mocked(userApi.ensureProfile).mockResolvedValue(remote);
    const updated = { ...remote, biographyMarkdown: 'My draft', version: 3 };
    vi.mocked(userApi.updateProfile).mockResolvedValueOnce(updated);
    const { client } = renderPage();
    const user = userEvent.setup();
    const editor = screen.getByRole('textbox', { name: 'Biography Markdown' });
    await user.clear(editor);
    await user.type(editor, 'My draft');
    act(() => client.setQueryData(profileQueryKey(profile.id), remote));
    await user.click(screen.getByRole('button', { name: 'Save Biography' }));
    await waitFor(() =>
      expect(userApi.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ biographyMarkdown: 'My draft', expectedVersion: 1 })
      )
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your Profile changed elsewhere. Refresh Biography before saving again.'
    );
    expect(editor).toHaveValue('My draft');
    await user.click(screen.getByRole('button', { name: 'Refresh Biography' }));
    expect(
      await screen.findByText('Biography refreshed. Your unsaved draft is preserved.')
    ).toBeInTheDocument();
    expect(editor).toHaveValue('My draft');
    await user.click(screen.getByRole('button', { name: 'Save Biography' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
    expect(userApi.updateProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ biographyMarkdown: 'My draft', expectedVersion: 2 })
    );
  });

  it('counts Unicode characters and enforces the owner-configured Biography limit', async () => {
    const initial = { ...profile, biographyMarkdown: '', biographyMaxLength: 2 };
    vi.mocked(userApi.updateProfile).mockResolvedValue({
      ...initial,
      biographyMarkdown: '🙂🙂',
      version: 2,
    });
    renderPage(initial);
    const user = userEvent.setup();
    const editor = screen.getByRole('textbox', { name: 'Biography Markdown' });
    await user.type(editor, '🙂🙂a');
    expect(screen.getByText('3 / 2 characters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Biography' })).toBeDisabled();
    expect(userApi.updateProfile).not.toHaveBeenCalled();
    await user.clear(editor);
    await user.type(editor, '🙂🙂');
    expect(screen.getByText('2 / 2 characters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Biography' }));
    await waitFor(() =>
      expect(userApi.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ biographyMarkdown: '🙂🙂' })
      )
    );
  });

  it('saves authored Markdown with the last-seen version and adopts the authoritative owner', async () => {
    const biographyMarkdown = '**Hello** 👋\n\nMy wallpaper collection.';
    const updated = { ...profile, biographyMarkdown, version: 2 };
    vi.mocked(userApi.updateProfile).mockResolvedValue(updated);
    const { client } = renderPage();
    const user = userEvent.setup();
    const editor = screen.getByRole('textbox', { name: 'Biography Markdown' });
    await user.clear(editor);
    await user.type(editor, biographyMarkdown);
    await user.click(screen.getByRole('button', { name: 'Save Biography' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
    expect(userApi.updateProfile).toHaveBeenCalledWith({
      biographyMarkdown,
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(editor).toHaveValue(biographyMarkdown);
    expect(
      screen.getByText('Biography saved. Public views may take a moment to update.')
    ).toBeInTheDocument();
  });
});
