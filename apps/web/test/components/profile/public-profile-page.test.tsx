import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { PublicProfilePage } from '@/components/profile/public-profile-page';
import { useWallpaperInfiniteQuery } from '@/hooks/useWallpaperInfiniteQuery';

vi.mock('@clerk/react', () => ({ useAuth: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string>;
  }) => (
    <a
      href={to + (search && Object.keys(search).length ? `?${new URLSearchParams(search)}` : '')}
      {...props}
    >
      {children}
    </a>
  ),
}));

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
    (useAuth as Mock).mockReturnValue({ isLoaded: true, isSignedIn: false, userId: null });
    (useWallpaperInfiniteQuery as Mock).mockReturnValue({
      data: { pages: [] },
      isLoading: false,
      isFetchingNextPage: false,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    });
  });

  it('offers profile editing only to the authenticated profile owner', () => {
    const profile = {
      id: 'user_ada',
      handle: 'ada',
      displayName: 'Ada Lovelace',
      biographyMarkdown: '',
      picture: null,
      canonicalPath: '/profiles/@ada',
    };
    (useAuth as Mock).mockReturnValue({ isLoaded: true, isSignedIn: true, userId: 'user_ada' });
    const rendered = render(<PublicProfilePage profile={profile} />);
    expect(screen.getByRole('link', { name: 'Edit profile' })).toHaveAttribute(
      'href',
      '/settings/profile'
    );
    (useAuth as Mock).mockReturnValue({ isLoaded: true, isSignedIn: true, userId: 'user_other' });
    rendered.rerender(<PublicProfilePage profile={profile} />);
    expect(screen.queryByRole('link', { name: 'Edit profile' })).not.toBeInTheDocument();
    (useAuth as Mock).mockReturnValue({ isLoaded: true, isSignedIn: false, userId: null });
    rendered.rerender(<PublicProfilePage profile={profile} />);
    expect(screen.queryByRole('link', { name: 'Edit profile' })).not.toBeInTheDocument();
  });

  it('renders authoritative owner Biography Markdown immediately and accepts a newer public projection', () => {
    const profile = {
      id: 'user_ada',
      handle: 'ada',
      displayName: 'Ada Lovelace',
      biographyMarkdown: '**Projected Biography**',
      picture: null,
      canonicalPath: '/profiles/@ada',
      version: 1,
    };
    const owner = {
      ...profile,
      biographyMarkdown: '**Owner Biography**',
      pictureAssetId: null,
      version: 2,
    };
    const client = new QueryClient();
    client.setQueryData(profileQueryKey(profile.id), owner);
    const view = (version: number) => (
      <QueryClientProvider client={client}>
        <PublicProfilePage profile={{ ...profile, version }} />
      </QueryClientProvider>
    );
    const rendered = render(view(1));
    expect(screen.getByText('Owner Biography').tagName).toBe('STRONG');
    act(() =>
      client.setQueryData(profileQueryKey(profile.id), {
        ...owner,
        biographyMarkdown: '**Saved Biography**',
        version: 3,
      })
    );
    expect(screen.getByText('Saved Biography').tagName).toBe('STRONG');
    rendered.rerender(view(4));
    expect(screen.getByText('Projected Biography').tagName).toBe('STRONG');
    act(() =>
      client.setQueryData(profileQueryKey(profile.id), { ...owner, id: 'another_user', version: 5 })
    );
    expect(screen.queryByText('Owner Biography')).not.toBeInTheDocument();
  });

  it('shows the latest saved owner name and handle before the public projection catches up', () => {
    const profile = {
      id: 'user_ada',
      handle: 'ada',
      displayName: 'Ada',
      biographyMarkdown: '',
      picture: null,
      canonicalPath: '/profiles/@ada',
      version: 1,
    };
    const client = new QueryClient();
    client.setQueryData(profileQueryKey(profile.id), {
      ...profile,
      displayName: 'Updated Ada',
      handle: 'updated-ada',
      version: 2,
    });
    render(
      <QueryClientProvider client={client}>
        <PublicProfilePage profile={profile} />
      </QueryClientProvider>
    );
    expect(screen.getByRole('heading', { name: 'Updated Ada' })).toBeInTheDocument();
    expect(screen.getByText('@updated-ada')).toBeInTheDocument();
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
    expect(screen.queryByRole('heading', { name: 'Biography' })).not.toBeInTheDocument();
    expect(screen.getByText('No biography yet.')).toBeInTheDocument();
    expect(firstFallback).toHaveTextContent('AL');

    const fallbackStyle = firstFallback.getAttribute('style');
    rerender(<PublicProfilePage profile={profile} />);
    expect(screen.getByRole('img', { name: "Ada Lovelace's profile picture" })).toHaveAttribute(
      'style',
      fallbackStyle
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
      />
    );

    expect(screen.getByRole('img', { name: "Grace Hopper's profile picture" })).toHaveAttribute(
      'src',
      'https://media.example/profile-picture.webp'
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
      />
    );

    expect(useWallpaperInfiniteQuery).toHaveBeenCalledWith({
      filter: { profileId: 'user_grace' },
    });
    expect(screen.queryByRole('heading', { name: 'Wallpapers' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Wallpapers' })).toBeInTheDocument();
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
      />
    );

    expect(screen.getByText('wlpr_loaded')).toBeInTheDocument();
    expect(screen.getByText('Could not load more wallpapers')).toBeInTheDocument();
  });
});
