import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileBootstrap, profileQueryKey } from '@/components/profile-bootstrap';
import { userApi, type Profile } from '@/lib/api/user';

vi.mock('@clerk/react', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api/user', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/user')>();
  return { ...original, userApi: { ensureProfile: vi.fn() } };
});

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

function auth(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    getToken: vi.fn().mockResolvedValue('token'),
    isLoaded: true,
    isSignedIn: true,
    userId: 'user_123',
    ...overrides,
  } as ReturnType<typeof useAuth>);
}

function renderBootstrap() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ProfileBootstrap />
      </QueryClientProvider>
    ),
  };
}

describe('ProfileBootstrap', () => {
  beforeEach(() => {
    vi.mocked(userApi.ensureProfile).mockReset();
    auth();
  });

  it.each([
    ['Clerk is loading', { isLoaded: false }],
    ['the session is signed out', { isSignedIn: false, userId: null }],
  ])('does not ensure a Profile while %s', async (_label, overrides) => {
    auth(overrides);
    renderBootstrap();

    await act(async () => {});
    expect(userApi.ensureProfile).not.toHaveBeenCalled();
  });

  it('retains the ensured Profile in the signed-in user query cache', async () => {
    vi.mocked(userApi.ensureProfile).mockResolvedValue(profile);
    const { queryClient } = renderBootstrap();

    await waitFor(() => expect(userApi.ensureProfile).toHaveBeenCalledOnce());
    await waitFor(() => expect(queryClient.getQueryData(profileQueryKey('user_123'))).toEqual(profile));
    expect(userApi.ensureProfile).toHaveBeenCalledWith(
      expect.objectContaining({ expectedProfileId: 'user_123', tokenProvider: expect.any(Function) })
    );
  });

  it('clears Profile cache on sign-out', async () => {
    vi.mocked(userApi.ensureProfile).mockResolvedValue(profile);
    const rendered = renderBootstrap();
    await waitFor(() => expect(rendered.queryClient.getQueryData(profileQueryKey('user_123'))).toEqual(profile));

    auth({ isSignedIn: false, userId: null });
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <ProfileBootstrap />
      </QueryClientProvider>
    );

    await waitFor(() => expect(rendered.queryClient.getQueryData(profileQueryKey('user_123'))).toBeUndefined());
  });

  it('isolates User changes from the previous session', async () => {
    vi.mocked(userApi.ensureProfile).mockResolvedValue(profile);
    const rendered = renderBootstrap();
    await waitFor(() => expect(rendered.queryClient.getQueryData(profileQueryKey('user_123'))).toEqual(profile));

    auth({ userId: 'user_456' });
    vi.mocked(userApi.ensureProfile).mockResolvedValue({ ...profile, id: 'user_456' });
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <ProfileBootstrap />
      </QueryClientProvider>
    );

    await waitFor(() => expect(rendered.queryClient.getQueryData(profileQueryKey('user_123'))).toBeUndefined());
    await waitFor(() =>
      expect(rendered.queryClient.getQueryData(profileQueryKey('user_456'))).toEqual({
        ...profile,
        id: 'user_456',
      })
    );
  });

  it('does not cancel the new User ensure request when the signed-in User changes', async () => {
    vi.mocked(userApi.ensureProfile).mockResolvedValueOnce(profile);
    const rendered = renderBootstrap();
    await waitFor(() => expect(rendered.queryClient.getQueryData(profileQueryKey('user_123'))).toEqual(profile));

    let resolveEnsure: ((profile: Profile) => void) | undefined;
    vi.mocked(userApi.ensureProfile).mockImplementationOnce(
      ({ signal }) =>
        new Promise((resolve, reject) => {
          resolveEnsure = resolve;
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
    );
    auth({ userId: 'user_456' });
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <ProfileBootstrap />
      </QueryClientProvider>
    );

    await waitFor(() => expect(userApi.ensureProfile).toHaveBeenCalledTimes(2));
    await act(async () => resolveEnsure?.({ ...profile, id: 'user_456' }));
    await waitFor(() =>
      expect(rendered.queryClient.getQueryData(profileQueryKey('user_456'))).toEqual({
        ...profile,
        id: 'user_456',
      })
    );
  });
});
