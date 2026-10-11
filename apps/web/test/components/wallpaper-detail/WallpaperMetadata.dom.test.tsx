import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WallpaperMetadata } from '@/components/wallpaper-detail/WallpaperMetadata';
import type { Wallpaper } from '@/lib/graphql/types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: React.ReactNode; params: { handle: string } }) => (
    <a href={`/profiles/@${params.handle}`}>{children}</a>
  ),
}));

const wallpaper: Wallpaper = {
  wallpaperId: 'wlpr_contributor',
  profileId: 'user_contributor',
  profile: {
    id: 'user_contributor',
    displayName: 'Ada Lovelace',
    handle: 'ada-lovelace',
    biographyMarkdown: '',
    picture: { id: 'pic_ada', url: 'https://media.example/pic_ada.webp' },
    canonicalPath: '/profiles/@ada-lovelace',
  },
  variants: [
    {
      width: 1920,
      height: 1080,
      aspectRatio: 16 / 9,
      format: 'image/webp',
      fileSizeBytes: 1024,
      createdAt: '2026-03-01T00:00:00.000Z',
      url: 'https://media.example/wallpaper.webp',
    },
  ],
  uploadedAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

describe('WallpaperMetadata contributor', () => {
  it('links a resolved contributor Profile with its picture and public identity', () => {
    render(
      <WallpaperMetadata wallpaper={wallpaper} selectedVariantIndex={0} onVariantSelect={vi.fn()} />,
    );

    expect(screen.getByRole('img', { name: "Ada Lovelace's profile picture" })).toHaveAttribute(
      'src',
      'https://media.example/pic_ada.webp',
    );
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('@ada-lovelace')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ada Lovelace/ })).toHaveAttribute(
      'href',
      '/profiles/@ada-lovelace',
    );
    expect(screen.queryByText('User ID')).not.toBeInTheDocument();
  });

  it('shows an unlinked Unknown Profile fallback when the projection is missing', () => {
    render(
      <WallpaperMetadata
        wallpaper={{ ...wallpaper, profileId: 'user_legacy', profile: null }}
        selectedVariantIndex={0}
        onVariantSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('img', { name: "Unknown Profile's profile picture" })).toBeInTheDocument();
    expect(screen.getByText('Unknown Profile')).toBeInTheDocument();
    expect(screen.getByText('user_legacy')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('User ID')).not.toBeInTheDocument();
  });
});
