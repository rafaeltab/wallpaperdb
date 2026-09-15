import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateProfileMarkdown } from '@wallpaperdb/profile-markdown';
import { BiographyMarkdown } from '@/components/profile/profile-biography';
import { request } from '@/lib/graphql/client';
import type { Wallpaper } from '@/lib/graphql/types';

vi.mock('@/lib/graphql/client', () => ({ request: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: React.ReactNode; params: { wallpaperId: string } }) => (
    <a href={`/wallpapers/${params.wallpaperId}`}>{children}</a>
  ),
}));

const profileId = 'user_123';

describe('Biography Markdown', () => {
  beforeEach(() => vi.mocked(request).mockReset());
  afterEach(() => vi.useRealTimers());

  it('keeps an external-link warning open across unrelated parent renders', async () => {
    const user = userEvent.setup();
    const biography = () => (
      <BiographyMarkdown profileId={profileId} markdown="[My website](https://example.com)" />
    );
    const { rerender } = render(biography());
    await user.click(screen.getByRole('button', { name: /my website.*example.com/i }));
    expect(screen.getByRole('alertdialog', { name: 'Leave WallpaperDB?' })).toBeInTheDocument();
    rerender(biography());
    const dialog = screen.getByRole('alertdialog', { name: 'Leave WallpaperDB?' });
    expect(within(dialog).getByRole('link', { name: 'Continue to example.com' })).toHaveAttribute(
      'href',
      'https://example.com/'
    );
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my website.*example.com/i })).toHaveFocus();
  });

  it('preserves an exhausted or ready embed across unrelated parent renders', async () => {
    vi.useFakeTimers();
    vi.mocked(request).mockResolvedValue({ getWallpaper: null });
    const client = new QueryClient();
    const biography = () => (
      <QueryClientProvider client={client}>
        <BiographyMarkdown profileId={profileId} markdown="![Forest](wallpaper:wlpr_own)" />
      </QueryClientProvider>
    );
    const { rerender } = render(biography());
    await act(async () => vi.advanceTimersByTimeAsync(1));
    for (const delay of [1000, 2000, 4000]) {
      await act(async () => vi.advanceTimersByTimeAsync(delay));
    }
    expect(request).toHaveBeenCalledTimes(4);
    for (let count = 0; count < 3; count += 1) {
      rerender(biography());
      await act(async () => vi.advanceTimersByTimeAsync(10000));
    }
    expect(request).toHaveBeenCalledTimes(4);
    vi.mocked(request).mockResolvedValue({
      getWallpaper: {
        wallpaperId: 'wlpr_own',
        profileId,
        uploadedAt: '',
        updatedAt: '',
        variants: [
          {
            width: 800,
            height: 600,
            aspectRatio: 4 / 3,
            format: 'image/webp',
            fileSizeBytes: 100,
            createdAt: '',
            url: '/media/own.webp',
          },
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try wallpaper again' }));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('img', { name: 'Forest' })).toBeInTheDocument();
    for (let count = 0; count < 3; count += 1) {
      rerender(biography());
      await act(async () => vi.advanceTimersByTimeAsync(10000));
    }
    expect(request).toHaveBeenCalledTimes(5);
  });

  it('starts a fresh retry budget when an exhausted embed changes wallpaper and Profile identity', async () => {
    vi.useFakeTimers();
    vi.mocked(request).mockResolvedValue({ getWallpaper: null });
    const client = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <BiographyMarkdown profileId={profileId} markdown="![Forest](wallpaper:wlpr_own)" />
      </QueryClientProvider>
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
    for (const delay of [1000, 2000, 4000]) {
      await act(async () => vi.advanceTimersByTimeAsync(delay));
    }
    expect(request).toHaveBeenCalledTimes(4);
    rerender(
      <QueryClientProvider client={client}>
        <BiographyMarkdown profileId="user_other" markdown="![Ocean](wallpaper:wlpr_other)" />
      </QueryClientProvider>
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(request).toHaveBeenCalledTimes(5);
    for (const delay of [1000, 2000, 4000, 60000]) {
      await act(async () => vi.advanceTimersByTimeAsync(delay));
    }
    expect(request).toHaveBeenCalledTimes(8);
    expect(request).toHaveBeenLastCalledWith(expect.any(String), { wallpaperId: 'wlpr_other' });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('bounds missing-embed retries and lets a public visitor explicitly try again', async () => {
    vi.useFakeTimers();
    vi.mocked(request).mockResolvedValue({ getWallpaper: null });
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <BiographyMarkdown profileId={profileId} markdown="![Forest](wallpaper:wlpr_own)" />
      </QueryClientProvider>
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
    for (const delay of [1000, 2000, 4000, 60000])
      await act(async () => vi.advanceTimersByTimeAsync(delay));
    expect(request).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const wallpaper: Wallpaper = {
      wallpaperId: 'wlpr_own',
      profileId,
      uploadedAt: '',
      updatedAt: '',
      variants: [
        {
          width: 800,
          height: 600,
          aspectRatio: 4 / 3,
          format: 'image/webp',
          fileSizeBytes: 100,
          createdAt: '',
          url: '/media/own.webp',
        },
      ],
    };
    vi.mocked(request).mockResolvedValue({ getWallpaper: wallpaper });
    fireEvent.click(screen.getByRole('button', { name: 'Try wallpaper again' }));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('img', { name: 'Forest' })).toHaveAttribute('src', '/media/own.webp');
    expect(request).toHaveBeenCalledTimes(5);
  });

  it('retries missing and unrenderable own wallpapers until a published variant arrives', async () => {
    vi.useFakeTimers();
    const wallpaper: Wallpaper = {
      wallpaperId: 'wlpr_own',
      profileId,
      uploadedAt: '',
      updatedAt: '',
      variants: [
        {
          width: 800,
          height: 600,
          aspectRatio: 4 / 3,
          format: 'image/webp',
          fileSizeBytes: 100,
          createdAt: '',
          url: '/media/own.webp',
        },
      ],
    };
    vi.mocked(request)
      .mockResolvedValueOnce({ getWallpaper: null })
      .mockResolvedValueOnce({ getWallpaper: { ...wallpaper, variants: [] } })
      .mockResolvedValue({ getWallpaper: wallpaper });
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <BiographyMarkdown profileId={profileId} markdown="![Forest](wallpaper:wlpr_own)" />
      </QueryClientProvider>
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('Wallpaper unavailable.')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('img', { name: 'Forest' })).toHaveAttribute('src', '/media/own.webp');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('supports configured long Biographies and limits only an explicitly bounded preview', () => {
    const text = 'a'.repeat(5500);
    const markdown = `**${text}**`;
    const { rerender } = render(
      <BiographyMarkdown profileId={profileId} markdown={markdown} maxCharacters={6000} />
    );
    expect(screen.getByText(text).tagName).toBe('STRONG');
    rerender(<BiographyMarkdown profileId={profileId} markdown={markdown} maxCharacters={5000} />);
    expect(screen.getByText('This Biography cannot be displayed safely.')).toBeInTheDocument();
    rerender(<BiographyMarkdown profileId={profileId} markdown={markdown} />);
    expect(screen.getByText(text).tagName).toBe('STRONG');
  });

  it.each([
    'missing',
    'foreign',
    'mismatched',
  ] as const)('withholds an embed when public Wallpaper data is %s', async (state) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wallpaper: Wallpaper = {
      wallpaperId: state === 'mismatched' ? 'different_wallpaper' : 'wlpr_own',
      profileId: state === 'foreign' ? 'another_user' : profileId,
      uploadedAt: '',
      updatedAt: '',
      variants: [
        {
          width: 800,
          height: 600,
          aspectRatio: 4 / 3,
          format: 'image/webp',
          fileSizeBytes: 100,
          createdAt: '',
          url: '/media/foreign.webp',
        },
      ],
    };
    vi.mocked(request).mockResolvedValueOnce({
      getWallpaper: state === 'missing' ? null : wallpaper,
    });
    render(
      <QueryClientProvider client={client}>
        <BiographyMarkdown profileId={profileId} markdown="![Forest](wallpaper:wlpr_own)" />
      </QueryClientProvider>
    );
    expect(await screen.findByText('Wallpaper unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders a published own-Wallpaper shorthand through the shared plugin and verified Wallpaper data', async () => {
    const wallpaper: Wallpaper = {
      wallpaperId: 'wlpr_own',
      profileId,
      uploadedAt: '',
      updatedAt: '',
      variants: [
        {
          width: 800,
          height: 600,
          aspectRatio: 4 / 3,
          format: 'image/webp',
          fileSizeBytes: 100,
          createdAt: '',
          url: '/media/wallpapers/wlpr_own.webp',
        },
      ],
    };
    vi.mocked(request).mockResolvedValueOnce({ getWallpaper: wallpaper });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <BiographyMarkdown
          profileId={profileId}
          markdown="My favorite: ![Forest at dawn](wallpaper:wlpr_own)"
        />
      </QueryClientProvider>
    );
    const picture = await screen.findByRole('img', { name: 'Forest at dawn' });
    expect(picture).toHaveAttribute('src', '/media/wallpapers/wlpr_own.webp');
    expect(picture.closest('a')).toHaveAttribute('href', '/wallpapers/wlpr_own');
    expect(container.querySelector('p div, p figure')).toBeNull();
    expect(request).toHaveBeenCalledWith(expect.any(String), { wallpaperId: 'wlpr_own' });
  });

  it('shows the normalized external destination and requires a keyboard-accessible warning before navigation', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BiographyMarkdown
        profileId={profileId}
        markdown="[My website](https://EXAMPLE.com:443/path?q=one#about)"
      />
    );
    expect(container.querySelector('a[href^="https:"]')).toBeNull();
    const trigger = screen.getByRole('button', { name: /my website.*example.com/i });
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('alertdialog', { name: 'Leave WallpaperDB?' });
    expect(dialog).toHaveTextContent('https://example.com/path?q=one#about');
    expect(dialog).toHaveTextContent('example.com');
    const continueLink = within(dialog).getByRole('link', { name: 'Continue to example.com' });
    expect(continueLink).toHaveAttribute('href', 'https://example.com/path?q=one#about');
    expect(continueLink).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(container.querySelector('a[href^="https:"]')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('fails closed for malicious Markdown that the shared authoring policy rejects', () => {
    const { rerender, container } = render(<BiographyMarkdown profileId={profileId} markdown="" />);
    for (const markdown of [
      '<img src=x onerror=alert(1)>',
      '[click](javascript:alert(1))',
      '[click](https://user:password@example.com)',
      '![photo](https://images.example/picture.png)',
      '![photo](data:image/png;base64,AAAA)',
      '[download](ftp://files.example/a)',
      '[![Forest](wallpaper:wlpr_own)](https://example.com)',
    ]) {
      expect(validateProfileMarkdown(markdown).valid).toBe(false);
      rerender(<BiographyMarkdown profileId={profileId} markdown={markdown} />);
      expect(screen.getByText('This Biography cannot be displayed safely.')).toBeInTheDocument();
      expect(container.querySelector('img, a, iframe, script')).toBeNull();
    }
  });

  it('renders the allowed Markdown and GFM subset into semantic React elements', () => {
    render(
      <BiographyMarkdown
        profileId={profileId}
        markdown={
          '# About me\n\n**Wallpaper collector** and ~~retired gamer~~.\n\n- Nature\n- Space\n\n> Made with care\n\n```text\nconst greeting = "hello";\n```\n\n| Genre | Count |\n| --- | --- |\n| Nature | 12 |'
        }
      />
    );
    expect(screen.getByRole('heading', { name: 'About me' })).toBeInTheDocument();
    expect(screen.getByText('Wallpaper collector').tagName).toBe('STRONG');
    expect(screen.getByText('retired gamer').tagName).toBe('DEL');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Made with care').closest('blockquote')).not.toBeNull();
    expect(screen.getByText('const greeting = "hello";').closest('pre')).not.toBeNull();
    expect(within(screen.getByRole('table')).getByRole('cell', { name: '12' })).toBeInTheDocument();
  });
});
