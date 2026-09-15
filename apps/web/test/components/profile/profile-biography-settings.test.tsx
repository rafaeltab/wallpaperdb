import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { ProfileSettingsPage } from '@/components/profile/profile-settings-page';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';

vi.mock('@clerk/react', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api/user', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/user')>();
  return { ...original, userApi: { ...original.userApi, ensureProfile: vi.fn(), updateProfile: vi.fn() } };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/profiles/@ada">{children}</a>,
}));
const profile: Profile = {
  id: 'user_123', handle: 'ada', displayName: 'Ada Lovelace', biographyMarkdown: 'Original Biography',
  pictureAssetId: null, pictureImportStatus: 'complete', version: 1, biographyMaxLength: 5000,
  createdAt: '2026-07-12T12:00:00.000Z', updatedAt: '2026-07-12T12:00:00.000Z',
};
function renderPage(initial = profile) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(profileQueryKey(profile.id), initial);
  return { client, ...render(<QueryClientProvider client={client}><ProfileSettingsPage /></QueryClientProvider>) };
}

describe('Biography settings', () => {
  beforeEach(() => {
    vi.mocked(useAuth, { partial: true }).mockReturnValue({ getToken: vi.fn().mockResolvedValue('token'), isLoaded: true, isSignedIn: true, userId: profile.id });
    vi.mocked(userApi.ensureProfile).mockReset();
    vi.mocked(userApi.updateProfile).mockReset();
  });

  it('counts Unicode characters and enforces the owner-configured Biography limit', async () => {
    const initial = { ...profile, biographyMarkdown: '', biographyMaxLength: 2 };
    vi.mocked(userApi.updateProfile).mockResolvedValue({ ...initial, biographyMarkdown: '🙂🙂', version: 2 });
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
    await waitFor(() => expect(userApi.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ biographyMarkdown: '🙂🙂' })));
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
    expect(userApi.updateProfile).toHaveBeenCalledWith({ biographyMarkdown, expectedVersion: 1, expectedProfileId: profile.id, tokenProvider: expect.any(Function) });
    expect(editor).toHaveValue(biographyMarkdown);
    expect(screen.getByText('Biography saved. Public views may take a moment to update.')).toBeInTheDocument();
  });
});
