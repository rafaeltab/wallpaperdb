import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { Wallpaper } from '@/lib/graphql/types';
import { WallpaperDetailPage } from '@/routes/wallpapers.$wallpaperId';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wallpaper: Wallpaper = {
  wallpaperId: 'wlpr_dialog',
  profileId: 'user_contributor',
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

describe('Wallpaper detail action feedback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it.each([
    'mounted',
    'away',
    'returned',
  ] as const)('keeps keyboard share feedback with its originating page: %s', async (destination) => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    localStorage.setItem('wallpaper-detail-panel-open', 'false');
    let complete: () => void = () => {};
    const copied = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const copy = vi.fn().mockReturnValueOnce(copied).mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
    const client = new QueryClient();
    for (const id of ['a', 'b'])
      client.setQueryData(['wallpaper', id], { ...wallpaper, wallpaperId: id });
    const root = createRootRoute();
    const route = createRoute({
      getParentRoute: () => root,
      path: '/wallpapers/$wallpaperId',
      component: WallpaperDetailPage,
    });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/wallpapers/a'] }),
    });
    const view = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    try {
      await screen.findByRole('button', { name: 'Share' });
      fireEvent.keyDown(window, { key: 's' });
      expect(copy).toHaveBeenCalledWith(expect.stringContaining('/wallpapers/a'));
      if (destination !== 'mounted')
        await act(() =>
          router.navigate({ to: '/wallpapers/$wallpaperId', params: { wallpaperId: 'b' } })
        );
      if (destination === 'returned')
        await act(() =>
          router.navigate({ to: '/wallpapers/$wallpaperId', params: { wallpaperId: 'a' } })
        );
      await act(async () => {
        complete();
      });
      if (destination === 'mounted')
        expect(toast.success).toHaveBeenCalledExactlyOnceWith('Link copied to clipboard');
      else expect(toast.success).not.toHaveBeenCalled();
      if (destination === 'returned') {
        fireEvent.click(screen.getByRole('button', { name: 'Share' }));
        await act(async () => {});
        expect(toast.success).toHaveBeenCalledExactlyOnceWith('Link copied to clipboard');
      }
    } finally {
      view.unmount();
      client.clear();
    }
  });
});

describe('Wallpaper detail dialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('starts at the original with loading feedback on each A to B to A navigation', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('fetch', vi.fn((_url, options) => {
      const id=JSON.parse(options.body).variables.wallpaperId;
      return Promise.resolve(new Response(JSON.stringify({data:{getWallpaper:{...wallpaper,wallpaperId:id,variants:[
        {...wallpaper.variants[0],url:`https://media.example/${id}-original.webp`},
        {...wallpaper.variants[0],width:640,height:360,url:`https://media.example/${id}-small.webp`},
      ]}}}),{headers:{'Content-Type':'application/json'}}));
    }));
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const root=createRootRoute();
    const route=createRoute({getParentRoute:()=>root,path:'/wallpapers/$wallpaperId',component:WallpaperDetailPage});
    const router=createRouter({routeTree:root.addChildren([route]),history:createMemoryHistory({initialEntries:['/wallpapers/a']})});
    render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);
    const original=await screen.findByAltText('Wallpaper 1920×1080');
    fireEvent.load(original);
    fireEvent.keyDown(window,{key:'ArrowRight'});
    fireEvent.load(await screen.findByAltText('Wallpaper 640×360'));
    for(const id of ['b','a']) {
      await act(async()=>{await router.navigate({to:'/wallpapers/$wallpaperId',params:{wallpaperId:id}});});
      const image=await screen.findByAltText('Wallpaper 1920×1080');
      expect(image).toHaveAttribute('src',`https://media.example/${id}-original.webp`);
      expect(screen.getByTestId('wallpaper-skeleton')).toBeInTheDocument();
      fireEvent.load(image);
    }
  });

  it('opens a named, described metadata dialog after loading and preserves keyboard dismissal', async () => {
    localStorage.clear();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    let respond: (response: Response) => void = () => {};
    const pendingResponse = new Promise<Response>((resolve) => { respond = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => pendingResponse));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute();
    const detailRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/wallpapers/$wallpaperId',
      component: WallpaperDetailPage,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([detailRoute]),
      history: createMemoryHistory({ initialEntries: ['/wallpapers/wlpr_dialog'] }),
    });
    const user = userEvent.setup();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    try {
      expect(await screen.findByRole('status', { name: 'Loading wallpaper details' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      respond(new Response(JSON.stringify({ data: { getWallpaper: wallpaper } }), {
        headers: { 'content-type': 'application/json' },
      }));

      const dialog = await screen.findByRole('dialog', { name: 'Wallpaper Details' });
      expect(dialog).toHaveAccessibleDescription('Wallpaper information, contributor, and available variants.');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await user.keyboard('i');
      expect(await screen.findByRole('dialog', { name: 'Wallpaper Details' })).toHaveAccessibleDescription(
        'Wallpaper information, contributor, and available variants.'
      );
    } finally {
      view.unmount();
      queryClient.clear();
    }
  });
});

describe('Wallpaper detail admission errors', () => {
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it.each([[429, false], [503, false], [429, true], [503, true]] as const)('shows HTTP %s safely with cached=%s and supports manual retry', async (status, cached) => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify({ errors: [{ message: 'private error' }] }),
      { status, headers: { 'content-type': 'application/json', 'retry-after': '0' } },
    )));
    vi.stubGlobal('fetch', fetch);
    const client = new QueryClient();
    if (cached) client.setQueryData(['wallpaper', wallpaper.wallpaperId], wallpaper, { updatedAt: 1 });
    localStorage.setItem('wallpaper-detail-panel-open', 'false');
    const root = createRootRoute();
    const route = createRoute({ getParentRoute: () => root, path: '/wallpapers/$wallpaperId', component: WallpaperDetailPage });
    const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/wallpapers/wlpr_dialog'] }) });
    const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    try {
      expect(await screen.findByRole('alert')).toHaveTextContent(status === 429 ? 'network' : 'busy');
      expect(screen.queryByText('Wallpaper not found')).not.toBeInTheDocument();
      expect(screen.queryByText('private error')).not.toBeInTheDocument();
      if (cached) expect(screen.getByRole('button', { name: 'Download original' })).toBeInTheDocument();
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled());
      const attempts = fetch.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await vi.waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(attempts));
    } finally { view.unmount(); client.clear(); }
  });
});
