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
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('adopts matching owner pictures and removals immediately while allowing newer public versions to win', () => {
    vi.stubEnv('VITE_MEDIA_URL', '/media');
    const client = new QueryClient();
    const owner: Profile = {
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
    expect(screen.getByRole('img')).toHaveAttribute('src', '/media/profile-pictures/owner_picture');
    act(() =>
      client.setQueryData(profileQueryKey(profile.id), {
        ...owner,
        version: 3,
        pictureAssetId: null,
      })
    );
    expect(screen.getByRole('img')).toHaveTextContent('AL');
    rendered.rerender(view(4));
    expect(screen.getByRole('img')).toHaveAttribute('src', profile.picture.url);
    rendered.rerender(view(1, 'another_user'));
    expect(screen.getByRole('img')).toHaveAttribute('src', profile.picture.url);
    for (const query of [GET_PROFILE, GET_PROFILE_BY_HANDLE, GET_WALLPAPER])
      expect(query).toMatch(/\bversion\b/);
  });

  it('shows its deterministic avatar after an image error and bounds retries until the asset changes', async () => {
    vi.useFakeTimers();
    const rendered = render(<ProfilePicture profile={profile} />);
    fireEvent.error(screen.getByAltText("Ada Lovelace's profile picture"));
    const fallback = screen.getByRole('img', { name: "Ada Lovelace's profile picture" });
    expect(fallback).toHaveTextContent('AL');
    const color = fallback.style.backgroundColor;

    for (const delay of [1000, 2000, 4000]) {
      await act(async () => vi.advanceTimersByTime(delay));
      const retry = screen.getByAltText("Ada Lovelace's profile picture");
      expect(retry).toHaveAttribute('src', profile.picture.url);
      fireEvent.error(retry);
      expect(
        screen.getByRole('img', { name: "Ada Lovelace's profile picture" }).style.backgroundColor
      ).toBe(color);
    }
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
    expect(screen.getByRole('img', { name: "Ada Lovelace's profile picture" })).toHaveAttribute(
      'src',
      '/media/profile-pictures/picture_2'
    );
  });
});
