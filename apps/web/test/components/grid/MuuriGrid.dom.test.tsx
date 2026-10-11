import type { PropsWithChildren } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MuuriGrid } from '@/components/grid/strategies/MuuriGrid';
import type { GridItemRendererProps } from '@/components/grid/types';

// Muuri animation is a driven adapter; exercise the real React expansion and sizing wiring.
vi.mock('@wallpaperdb/react-muuri', () => ({
  MuuriGrid: ({ children }: PropsWithChildren) => <div>{children}</div>,
  MuuriItem: ({ children }: PropsWithChildren) => <div>{children}</div>,
  useRefresh: () => ({ refresh: () => {} }),
}));

const items = ['first', 'second'].map((id) => ({ id, src: '/image.png', width: 1000, height: 1000, aspectRatio: 1 }));
function Item({ item, isExpanded, span, onClick }: GridItemRendererProps) {
  return <button type="button" onClick={onClick} aria-expanded={isExpanded}>
    {item.id} {span.cols}x{span.rows}
  </button>;
}

afterEach(() => vi.restoreAllMocks());

describe('Muuri grid expansion composition', () => {
  it('expands one item, transfers expansion, and collapses a repeated click', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 1000, 600));
    const onItemClick = vi.fn();
    render(<MuuriGrid items={items} ItemRenderer={Item} onItemClick={onItemClick} />);
    const first = screen.getByRole('button', { name: 'first 1x1' });
    const second = screen.getByRole('button', { name: 'second 1x1' });
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(first).toHaveTextContent('first 2x2');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(second);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(onItemClick.mock.calls.map(([item]) => item.id)).toEqual(['first', 'second', 'second']);
  });

  it('allows expansion without a notification callback and recomputes sizes on resize', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
    const { container } = render(<MuuriGrid items={items} ItemRenderer={Item} />);
    const first = screen.getByRole('button', { name: 'first 1x1' });
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const wrapper = container.querySelector('[data-item-id="first"]')!.firstElementChild!;
    const originalWidth = (wrapper as HTMLElement).style.width;
    width.mockReturnValue(300);
    fireEvent(window, new Event('resize'));
    expect((wrapper as HTMLElement).style.width).not.toBe(originalWidth);
    expect(Number.parseFloat((wrapper as HTMLElement).style.width)).toBeLessThanOrEqual(300);
  });
});
