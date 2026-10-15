import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { profileQueryKey } from '@/components/profile-bootstrap';
import type { Profile } from '@/lib/api/user';
import { GET_PROFILE, GET_PROFILE_BY_HANDLE, GET_WALLPAPER } from '@/lib/graphql/queries';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfilePicture } from '@/components/profile/profile-picture';

const profile = {
  id: 'user_123',
  displayName: 'Ada Lovelace',
  picture: { id: 'picture_1', url: '/media/profile-pictures/picture_1' },
};

describe('ProfilePicture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('shows a muted loading status without initials until the picture is ready', () => {
    render(<ProfilePicture profile={profile} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading profile picture');
    expect(screen.getByRole('img')).not.toHaveTextContent('AL');
    const image = screen.getByAltText("Ada Lovelace's profile picture");
    expect(image).toHaveAttribute('aria-hidden', 'true');
    fireEvent.load(image);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute('src', profile.picture.url);
  });

  it('recovers a signed-out same-version picture when the window regains focus after an outage', async () => {
    vi.useFakeTimers();
    render(<ProfilePicture profile={profile} />);
    fireEvent.error(screen.getByAltText("Ada Lovelace's profile picture"));
    for (const delay of [1000, 2000, 4000]) {
      await act(async () => vi.advanceTimersByTimeAsync(delay));
      fireEvent.error(screen.getByAltText("Ada Lovelace's profile picture"));
    }
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(screen.queryByAltText("Ada Lovelace's profile picture")).not.toBeInTheDocument();
    fireEvent(window, new Event('focus'));
    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute(
      'src',
      profile.picture.url
    );
  });

  it('retries an exhausted same-asset picture after an owner refresh or public projection convergence', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_MEDIA_URL', '/media');
    const client = new QueryClient();
    const owner: Profile = {
      pictureUploadLimits: { maxBytes: 5242880, maxPixels: 20000000, maxDecodedBytes: 80000000 },
      ...profile,
      handle: 'ada',
      biographyMarkdown: '',
      pictureAssetId: profile.picture.id,
      version: 2,
      createdAt: '',
      updatedAt: '',
    };
    client.setQueryData(profileQueryKey(profile.id), owner);
    const view = (version: number) => (
      <QueryClientProvider client={client}>
        <ProfilePicture profile={{ ...profile, version }} />
      </QueryClientProvider>
    );
    const rendered = render(view(1));
    async function exhaust() {
      fireEvent.error(screen.getByAltText("Ada Lovelace's profile picture"));
      for (const delay of [1000, 2000, 4000]) {
        await act(async () => vi.advanceTimersByTimeAsync(delay));
        fireEvent.error(screen.getByAltText("Ada Lovelace's profile picture"));
      }
      expect(screen.queryByAltText("Ada Lovelace's profile picture")).not.toBeInTheDocument();
    }
    await exhaust();
    await act(async () => {
      await client.fetchQuery({
        queryKey: profileQueryKey(profile.id),
        queryFn: async () => owner,
        staleTime: 0,
      });
    });
    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute(
      'src',
      profile.picture.url
    );
    await exhaust();
    rendered.rerender(view(2));
    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute(
      'src',
      profile.picture.url
    );
  });

  it('adopts matching owner pictures and removals immediately while allowing newer public versions to win', () => {
    vi.stubEnv('VITE_MEDIA_URL', '/media');
    const client = new QueryClient();
    const owner: Profile = {
      pictureUploadLimits: { maxBytes: 5242880, maxPixels: 20000000, maxDecodedBytes: 80000000 },
      ...profile,
      handle: 'ada',
      biographyMarkdown: '',
      pictureAssetId: 'owner_picture',
      version: 2,
      createdAt: '',
      updatedAt: '',
    };
    client.setQueryData(profileQueryKey(profile.id), owner);
    const view = (version: number, id = profile.id) => (
      <QueryClientProvider client={client}>
        <ProfilePicture profile={{ ...profile, id, version }} />
      </QueryClientProvider>
    );
    const rendered = render(view(1));
    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute('src', '/media/profile-pictures/owner_picture');
    act(() =>
      client.setQueryData(profileQueryKey(profile.id), {
        ...owner,
        version: 3,
        pictureAssetId: null,
      })
    );
    expect(screen.getByRole('img')).toHaveTextContent('AL');
    rendered.rerender(view(4));
    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute('src', profile.picture.url);
    rendered.rerender(view(1, 'another_user'));
    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute('src', profile.picture.url);
    for (const query of [GET_PROFILE, GET_PROFILE_BY_HANDLE, GET_WALLPAPER])
      expect(query).toMatch(/\bversion\b/);
  });

  it('keeps loading between bounded retries and explains the terminal fallback until the asset changes', async () => {
    vi.useFakeTimers();
    const rendered = render(<ProfilePicture profile={profile} />);
    fireEvent.error(screen.getByAltText("Ada Lovelace's profile picture"));
    const fallback = screen.getByRole('img', { name: "Ada Lovelace's profile picture" });
    expect(fallback).not.toHaveTextContent('AL');
    expect(screen.getByRole('status')).toHaveTextContent('Loading profile picture');

    for (const delay of [1000, 2000, 4000]) {
      await act(async () => vi.advanceTimersByTime(delay));
      const retry = screen.getByAltText("Ada Lovelace's profile picture");
      expect(retry).toHaveAttribute('src', profile.picture.url);
      fireEvent.error(retry);
      if (delay < 4000) {
        expect(screen.getByRole('status')).toHaveTextContent('Loading profile picture');
        expect(screen.getByRole('img')).not.toHaveTextContent('AL');
      }
    }
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveTextContent('AL');
    expect(screen.getByRole('img')).toHaveAccessibleDescription('Profile picture unavailable');
    await act(async () => vi.advanceTimersByTime(60000));
    expect(screen.queryByAltText("Ada Lovelace's profile picture")).not.toBeInTheDocument();

    rendered.rerender(
      <ProfilePicture
        profile={{
          ...profile,
          picture: { id: 'picture_2', url: '/media/profile-pictures/picture_2' },
        }}
      />
    );
    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute(
      'src',
      '/media/profile-pictures/picture_2'
    );
    fireEvent.load(screen.getByAltText("Ada Lovelace's profile picture"));
    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute(
      'src',
      '/media/profile-pictures/picture_2'
    );
  });

  it.each(['focus', 'online', 'visibilitychange'])('bounds stalled loads and gives %s recovery a fresh loading budget', async (event) => {
    vi.useFakeTimers();
    render(<ProfilePicture profile={profile} />);
    await act(async () => vi.advanceTimersByTimeAsync(14999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('img')).toHaveAccessibleDescription('Profile picture unavailable');
    const target = event === 'visibilitychange' ? document : window;
    fireEvent(target, new Event(event));
    expect(screen.getByRole('status')).toHaveTextContent('Loading profile picture');
    await act(async () => vi.advanceTimersByTimeAsync(14999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.load(screen.getByAltText("Ada Lovelace's profile picture"));
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute('src', profile.picture.url);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('counts retry waits in the overall loading budget and ignores a late success', async () => {
    vi.useFakeTimers();
    render(<ProfilePicture profile={profile} />);
    await act(async () => vi.advanceTimersByTimeAsync(13000));
    fireEvent.error(screen.getByAltText("Ada Lovelace's profile picture"));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    const retry = screen.getByAltText("Ada Lovelace's profile picture");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    fireEvent.load(retry);
    expect(screen.getByRole('img')).toHaveAccessibleDescription('Profile picture unavailable');
  });

  it('shows a cached image immediately when the browser reports it already complete', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(512);
    render(<ProfilePicture profile={profile} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute('src', profile.picture.url);
  });

  it('abandons replaced pictures, Profiles, Reset, and unmounted loading lifetimes', async () => {
    vi.useFakeTimers();
    const view = render(<ProfilePicture profile={profile} />);
    const original = screen.getByAltText("Ada Lovelace's profile picture");
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    const replacement = { ...profile, picture: { id: 'new', url: '/new-picture' } };
    view.rerender(<ProfilePicture profile={replacement} />);
    fireEvent.load(original);
    fireEvent.error(original);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByRole('status')).toBeInTheDocument();
    const previousProfile = screen.getByAltText("Ada Lovelace's profile picture");
    view.rerender(<ProfilePicture profile={{ ...replacement, id: 'another-profile', displayName: 'Grace Hopper' }} />);
    fireEvent.load(previousProfile);
    expect(screen.getByRole('status')).toBeInTheDocument();
    const pending = screen.getByAltText("Grace Hopper's profile picture");
    view.rerender(<ProfilePicture profile={{ ...profile, picture: null }} />);
    fireEvent.load(pending);
    fireEvent.error(pending);
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(screen.getByRole('img')).toHaveTextContent('AL');
    expect(screen.getByRole('img')).not.toHaveAccessibleDescription();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    view.rerender(<ProfilePicture profile={profile} />);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
