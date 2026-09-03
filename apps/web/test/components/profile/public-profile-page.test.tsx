import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PublicProfilePage } from '@/components/profile/public-profile-page';

describe('PublicProfilePage', () => {
  it('renders the public identity and default Biography with a deterministic picture fallback', () => {
    const profile = {
      id: 'user_ada',
      handle: 'ada-lovelace',
      displayName: 'Ada Lovelace',
      biographyMarkdown: '',
      picture: null,
      canonicalPath: '/profiles/@ada-lovelace',
    };

    const { rerender } = render(<PublicProfilePage profile={profile} />);
    const firstFallback = screen.getByRole('img', { name: "Ada Lovelace's profile picture" });

    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('@ada-lovelace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Biography' })).toBeInTheDocument();
    expect(screen.getByText('No biography yet.')).toBeInTheDocument();
    expect(firstFallback).toHaveTextContent('AL');

    const fallbackStyle = firstFallback.getAttribute('style');
    rerender(<PublicProfilePage profile={profile} />);
    expect(screen.getByRole('img', { name: "Ada Lovelace's profile picture" })).toHaveAttribute(
      'style',
      fallbackStyle,
    );
  });

  it('renders the Profile picture URL when one is available', () => {
    render(
      <PublicProfilePage
        profile={{
          id: 'user_grace',
          handle: 'grace-hopper',
          displayName: 'Grace Hopper',
          biographyMarkdown: 'Compiler pioneer',
          picture: { id: 'picture_1', url: 'https://media.example/profile-picture.webp' },
          canonicalPath: '/profiles/@grace-hopper',
        }}
      />,
    );

    expect(screen.getByRole('img', { name: "Grace Hopper's profile picture" })).toHaveAttribute(
      'src',
      'https://media.example/profile-picture.webp',
    );
    expect(screen.getByText('Compiler pioneer')).toBeInTheDocument();
  });
});
