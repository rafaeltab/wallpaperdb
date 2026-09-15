import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfilePicture } from '@/components/profile/profile-picture';

const profile = {
  id: 'user_123',
  displayName: 'Ada Lovelace',
  picture: { id: 'picture_1', url: '/media/profile-pictures/picture_1' },
};

describe('ProfilePicture', () => {
  afterEach(() => vi.useRealTimers());

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
