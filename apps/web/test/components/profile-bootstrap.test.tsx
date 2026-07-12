import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileBootstrap, profileQueryKey } from '@/components/profile-bootstrap';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';

vi.mock('@clerk/react', () => ({ useAuth: vi.fn() }));
vi.mock('@/components/auth-bridge', () => ({ useAuthTokenReady: vi.fn(() => true) }));
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

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
}

function renderBootstrap(queryClient = createClient()) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ProfileBootstrap />
      </QueryClientProvider>,
    ),
  };
}

function auth(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
    userId: 'user_123',
    ...overrides,
  } as ReturnType<typeof useAuth>);
}

describe('ProfileBootstrap', () => {
  beforeEach(() => {
    vi.mocked(userApi.ensureProfile).mockReset();
    auth();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['Clerk is loading', { isLoaded: false }],
    ['the user is signed out', { isSignedIn: false, userId: null }],
    ['the Clerk user ID is unavailable', { userId: null }],
  ])('waits when %s', async (_label, overrides) => {
    auth(overrides);
    renderBootstrap();

    await act(async () => {});
    expect(userApi.ensureProfile).not.toHaveBeenCalled();
  });

  it('stores the authoritative profile under the Clerk user ID', async () => {
    vi.mocked(userApi.ensureProfile).mockResolvedValue(profile);
    const { queryClient } = renderBootstrap();

    await waitFor(() => expect(userApi.ensureProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryClient.getQueryData(profileQueryKey('user_123'))).toEqual(profile));
  });

  it('deduplicates bootstrap requests for the same Clerk user', async () => {
    let resolveProfile: (value: Profile) => void = () => {};
    vi.mocked(userApi.ensureProfile).mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      }),
    );
    const queryClient = createClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    render(<ProfileBootstrap />, { wrapper });
    render(<ProfileBootstrap />, { wrapper });

    await waitFor(() => expect(userApi.ensureProfile).toHaveBeenCalledTimes(1));
    resolveProfile(profile);
  });

  it('retries transient failures and caches the recovered profile', async () => {
    vi.mocked(userApi.ensureProfile)
      .mockRejectedValueOnce(new UserApiError('Unavailable', 503))
      .mockResolvedValueOnce(profile);
    const { queryClient } = renderBootstrap();

    await waitFor(() => expect(userApi.ensureProfile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(queryClient.getQueryData(profileQueryKey('user_123'))).toEqual(profile));
  });

  it('retains a terminal error in the query cache after retries', async () => {
    vi.mocked(userApi.ensureProfile).mockRejectedValue(new UserApiError('Unavailable', 503));
    const { queryClient } = renderBootstrap();

    await waitFor(() => expect(userApi.ensureProfile).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(queryClient.getQueryState(profileQueryKey('user_123'))?.status).toBe('error'),
    );
  });

  it('clears the previous profile when the Clerk user changes', async () => {
    vi.mocked(userApi.ensureProfile).mockResolvedValue(profile);
    const rendered = renderBootstrap();
    await waitFor(() => expect(rendered.queryClient.getQueryData(profileQueryKey('user_123'))).toEqual(profile));

    auth({ userId: 'user_456' });
    vi.mocked(userApi.ensureProfile).mockResolvedValue({ ...profile, id: 'user_456' });
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <ProfileBootstrap />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(rendered.queryClient.getQueryData(profileQueryKey('user_123'))).toBeUndefined());
  });

  it('clears cached profiles on sign-out', async () => {
    vi.mocked(userApi.ensureProfile).mockResolvedValue(profile);
    const rendered = renderBootstrap();
    await waitFor(() => expect(rendered.queryClient.getQueryData(profileQueryKey('user_123'))).toEqual(profile));

    auth({ isSignedIn: false, userId: null });
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <ProfileBootstrap />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(rendered.queryClient.getQueryData(profileQueryKey('user_123'))).toBeUndefined());
  });
});
