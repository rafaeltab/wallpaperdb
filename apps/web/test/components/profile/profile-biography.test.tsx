import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { validateProfileMarkdown } from '@wallpaperdb/profile-markdown';
import { BiographyMarkdown } from '@/components/profile/profile-biography';

const profileId = 'user_123';

describe('Biography Markdown', () => {
  it('fails closed for malicious Markdown that the shared authoring policy rejects', () => {
    const { rerender, container } = render(<BiographyMarkdown profileId={profileId} markdown="" />);
    for (const markdown of ['<img src=x onerror=alert(1)>', '[click](javascript:alert(1))', '[click](https://user:password@example.com)', '![photo](https://images.example/picture.png)', '![photo](data:image/png;base64,AAAA)', '[download](ftp://files.example/a)']) {
      expect(validateProfileMarkdown(markdown).valid).toBe(false);
      rerender(<BiographyMarkdown profileId={profileId} markdown={markdown} />);
      expect(screen.getByText('This Biography cannot be displayed safely.')).toBeInTheDocument();
      expect(container.querySelector('img, a, iframe, script')).toBeNull();
    }
  });

  it('renders the allowed Markdown and GFM subset into semantic React elements', () => {
    render(<BiographyMarkdown profileId={profileId} markdown={'# About me\n\n**Wallpaper collector** and ~~retired gamer~~.\n\n- Nature\n- Space\n\n> Made with care\n\n```text\nconst greeting = "hello";\n```\n\n| Genre | Count |\n| --- | --- |\n| Nature | 12 |'} />);
    expect(screen.getByRole('heading', { name: 'About me' })).toBeInTheDocument();
    expect(screen.getByText('Wallpaper collector').tagName).toBe('STRONG');
    expect(screen.getByText('retired gamer').tagName).toBe('DEL');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Made with care').closest('blockquote')).not.toBeNull();
    expect(screen.getByText('const greeting = "hello";').closest('pre')).not.toBeNull();
    expect(within(screen.getByRole('table')).getByRole('cell', { name: '12' })).toBeInTheDocument();
  });
});
