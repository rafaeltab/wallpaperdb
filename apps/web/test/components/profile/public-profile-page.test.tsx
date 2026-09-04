import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { PublicProfilePage } from '@/components/profile/public-profile-page';
import { useWallpaperInfiniteQuery } from '@/hooks/useWallpaperInfiniteQuery';

vi.mock('@/hooks/useWallpaperInfiniteQuery', () => ({
  useWallpaperInfiniteQuery: vi.fn(),
}));

vi.mock('@/components/WallpaperGrid', () => ({
  WallpaperGrid: ({
    wallpapers,
    isLoadingMore,
  }: {
    wallpapers: Array<{ wallpaperId: string }>;
    isLoadingMore: boolean;
  }) => (
    <div data-testid="profile-wallpaper-grid" data-loading={isLoadingMore}>
      {wallpapers.map((wallpaper) => (
        <span key={wallpaper.wallpaperId}>{wallpaper.wallpaperId}</span>
      ))}
    </div>
  ),
}));

vi.mock('@/components/LoadMoreTrigger', () => ({
  LoadMoreTrigger: ({ onLoadMore, hasMore }: { onLoadMore: () => void; hasMore: boolean }) =>
    hasMore ? <button onClick={onLoadMore}>Load more wallpapers</button> : null,
}));

describe('PublicProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useWallpaperInfiniteQuery as Mock).mockReturnValue({
      data: { pages: [] },
      isLoading: false,
      isFetchingNextPage: false,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    });
  });

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

  it('shows the contributor wallpapers across pages and loads the next page', () => {
    const fetchNextPage = vi.fn();
    (useWallpaperInfiniteQuery as Mock).mockReturnValue({
      data: {
        pages: [
          { edges: [{ node: { wallpaperId: 'wlpr_profile_001' } }] },
          { edges: [{ node: { wallpaperId: 'wlpr_profile_002' } }] },
        ],
      },
      isLoading: false,
      isFetchingNextPage: false,
      error: null,
      hasNextPage: true,
      fetchNextPage,
    });

    render(
      <PublicProfilePage
        profile={{
          id: 'user_grace',
          handle: 'grace-hopper',
          displayName: 'Grace Hopper',
          biographyMarkdown: 'Compiler pioneer',
          picture: null,
          canonicalPath: '/profiles/@grace-hopper',
        }}
      />,
    );

    expect(useWallpaperInfiniteQuery).toHaveBeenCalledWith({
      filter: { profileId: 'user_grace' },
    });
    expect(screen.getByRole('heading', { name: 'Wallpapers' })).toBeInTheDocument();
    expect(screen.getByText('wlpr_profile_001')).toBeInTheDocument();
    expect(screen.getByText('wlpr_profile_002')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more wallpapers' }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it('shows loading, empty, and initial-error states without presenting stale content', () => {
    (useWallpaperInfiniteQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetchingNextPage: false,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    });

    const profile = {
      id: 'user_states',
      handle: 'states',
      displayName: 'State Tester',
      biographyMarkdown: '',
      picture: null,
      canonicalPath: '/profiles/@states',
    };
    const { rerender } = render(<PublicProfilePage profile={profile} />);
    expect(screen.getByTestId('profile-wallpaper-grid')).toHaveAttribute('data-loading', 'true');

    (useWallpaperInfiniteQuery as Mock).mockReturnValue({
      data: { pages: [] },
      isLoading: false,
      isFetchingNextPage: false,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    });
    rerender(<PublicProfilePage profile={profile} />);
    expect(screen.getByText('No wallpapers yet.')).toBeInTheDocument();

    (useWallpaperInfiniteQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetchingNextPage: false,
      error: new Error('offline'),
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    });
    rerender(<PublicProfilePage profile={profile} />);
    expect(screen.getByText('Could not load wallpapers')).toBeInTheDocument();
    expect(screen.queryByText('No wallpapers yet.')).not.toBeInTheDocument();
  });

  it('keeps loaded wallpapers visible when loading another page fails', () => {
    (useWallpaperInfiniteQuery as Mock).mockReturnValue({
      data: { pages: [{ edges: [{ node: { wallpaperId: 'wlpr_loaded' } }] }] },
      isLoading: false,
      isFetchingNextPage: false,
      error: new Error('offline'),
      hasNextPage: true,
      fetchNextPage: vi.fn(),
    });

    render(
      <PublicProfilePage
        profile={{
          id: 'user_loaded',
          handle: 'loaded',
          displayName: 'Loaded Contributor',
          biographyMarkdown: '',
          picture: null,
          canonicalPath: '/profiles/@loaded',
        }}
      />,
    );

    expect(screen.getByText('wlpr_loaded')).toBeInTheDocument();
    expect(screen.getByText('Could not load more wallpapers')).toBeInTheDocument();
  });
});
