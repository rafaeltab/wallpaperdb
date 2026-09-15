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
    userApi: {
      ...original.userApi,
      ensureProfile: vi.fn(),
      uploadPicture: vi.fn(),
      removePicture: vi.fn(),
    },
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/profiles/@ada">{children}</a>,
}));

const profile: Profile = {
  id: 'user_123',
  handle: 'ada',
  displayName: 'Ada Lovelace',
  biographyMarkdown: '',
  pictureAssetId: null,
  pictureImportStatus: 'complete',
  version: 1,
  pictureUploadLimits: { maxBytes: 5242880, maxPixels: 20000000, maxDecodedBytes: 80000000 },
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

describe('Profile picture settings', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      getToken: vi.fn().mockResolvedValue('token'),
      isLoaded: true,
      isSignedIn: true,
      userId: profile.id,
    } as ReturnType<typeof useAuth>);
    vi.mocked(userApi.ensureProfile).mockReset();
    vi.mocked(userApi.uploadPicture).mockReset();
    vi.mocked(userApi.removePicture).mockReset();
  });

  it('confirms picture removal with the version seen when the dialog opened and keeps cancellation local', async () => {
    const initial = { ...profile, pictureAssetId: 'picture_old' };
    const updated = { ...profile, version: 3 };
    vi.mocked(userApi.removePicture).mockResolvedValue(updated);
    const { client } = renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove picture' }));
    let dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/generated avatar/i);
    expect(dialog).toHaveTextContent(/pending picture import/i);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(userApi.removePicture).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove picture' }));
    dialog = screen.getByRole('alertdialog');
    act(() =>
      client.setQueryData(profileQueryKey(profile.id), {
        ...initial,
        version: 2,
        pictureAssetId: 'newer_unseen',
      })
    );
    await user.click(within(dialog).getByRole('button', { name: 'Use generated avatar' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
    expect(userApi.removePicture).toHaveBeenCalledWith({
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(screen.getByRole('img', { name: "Ada Lovelace's profile picture" })).toHaveTextContent(
      'AL'
    );
  });

  it('uploads the selected file with its captured version and immediately adopts the authoritative picture', async () => {
    const updated = { ...profile, pictureAssetId: 'picture_new', version: 3 };
    vi.mocked(userApi.uploadPicture).mockResolvedValue(updated);
    const { client } = renderPage();
    const user = userEvent.setup();
    const picture = new File(['png'], 'portrait.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Choose picture'), picture);
    act(() => client.setQueryData(profileQueryKey(profile.id), { ...profile, version: 2 }));
    await user.click(screen.getByRole('button', { name: 'Upload picture' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
    expect(userApi.uploadPicture).toHaveBeenCalledWith({
      picture,
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(screen.getByRole('img', { name: "Ada Lovelace's profile picture" })).toHaveAttribute(
      'src',
      '/media/profile-pictures/picture_new'
    );
    expect(
      screen.getByText('Picture saved. Public views may take a moment to update.')
    ).toBeInTheDocument();
  });
});
