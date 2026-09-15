import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
  beforeEach(() => {
    vi.mocked(useAuth, { partial: true }).mockReturnValue({
      getToken: vi.fn().mockResolvedValue('token'),
      isLoaded: true,
      isSignedIn: true,
      userId: profile.id,
    });
    vi.mocked(userApi.ensureProfile).mockReset();
    vi.mocked(userApi.updateProfile).mockReset();
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
    expect(within(preview).getByText('This Biography cannot be displayed safely.')).toBeInTheDocument();
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
