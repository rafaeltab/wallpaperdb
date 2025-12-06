import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MuuriGrid } from '../src/MuuriGrid.js';
import { MuuriItem } from '../src/MuuriItem.js';

describe('MuuriItem', () => {
  describe('rendering', () => {
    it('should render an item container div', () => {
      render(
        <MuuriGrid>
          <MuuriItem data-testid="item">
            <div>Content</div>
          </MuuriItem>
        </MuuriGrid>
      );

      expect(screen.getByTestId('item')).toBeInTheDocument();
    });

    it('should render children inside inner container', () => {
      render(
        <MuuriGrid>
          <MuuriItem>
            <div data-testid="child">Child Content</div>
          </MuuriItem>
        </MuuriGrid>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('should render multiple children', () => {
      render(
        <MuuriGrid>
          <MuuriItem>
            <div data-testid="child1">Child 1</div>
            <div data-testid="child2">Child 2</div>
          </MuuriItem>
        </MuuriGrid>
      );

      expect(screen.getByTestId('child1')).toBeInTheDocument();
      expect(screen.getByTestId('child2')).toBeInTheDocument();
    });

    it('should apply className prop', () => {
      render(
        <MuuriGrid>
          <MuuriItem className="my-item" data-testid="item">
            <div>Content</div>
          </MuuriItem>
        </MuuriGrid>
      );

      expect(screen.getByTestId('item')).toHaveClass('my-item');
    });

    it('should have position absolute style', () => {
      render(
        <MuuriGrid>
          <MuuriItem data-testid="item">
            <div>Content</div>
          </MuuriItem>
        </MuuriGrid>
      );

      // Item should have position: absolute (required by Muuri)
      expect(screen.getByTestId('item')).toHaveStyle({ position: 'absolute' });
    });

    it('should forward other HTML attributes', () => {
      render(
        <MuuriGrid>
          <MuuriItem id="my-id" data-custom="value" data-testid="item">
            <div>Content</div>
          </MuuriItem>
        </MuuriGrid>
      );

      const item = screen.getByTestId('item');
      expect(item).toHaveAttribute('id', 'my-id');
      expect(item).toHaveAttribute('data-custom', 'value');
    });
  });

  describe('Muuri item structure', () => {
    it('should have two-level structure (outer + inner)', () => {
      render(
        <MuuriGrid>
          <MuuriItem data-testid="item">
            <div data-testid="content">Content</div>
          </MuuriItem>
        </MuuriGrid>
      );

      const item = screen.getByTestId('item');
      const content = screen.getByTestId('content');

      // Content should be inside item but not a direct child
      expect(item).toContainElement(content);
      // There should be an inner wrapper
      expect(item.firstChild).not.toBe(content);
    });

    it('should have position: absolute on outer element', () => {
      render(
        <MuuriGrid>
          <MuuriItem data-testid="item">
            <div>Content</div>
          </MuuriItem>
        </MuuriGrid>
      );

      // Muuri sets position: absolute on items
      expect(screen.getByTestId('item')).toHaveStyle({ position: 'absolute' });
    });
  });

  describe('Muuri CSS classes', () => {
    it('should have muuri-item class by default', async () => {
      const onLayoutEnd = vi.fn();

      render(
        <MuuriGrid onLayoutEnd={onLayoutEnd}>
          <MuuriItem data-testid="item">
            <div style={{ width: 100, height: 100 }}>Content</div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(onLayoutEnd).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      expect(screen.getByTestId('item')).toHaveClass('muuri-item');
    });

    it('should apply custom itemClass from grid', async () => {
      const onLayoutEnd = vi.fn();

      render(
        <MuuriGrid itemClass="custom-item" onLayoutEnd={onLayoutEnd}>
          <MuuriItem data-testid="item">
            <div style={{ width: 100, height: 100 }}>Content</div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(onLayoutEnd).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      expect(screen.getByTestId('item')).toHaveClass('custom-item');
    });
  });

  describe('registration with grid', () => {
    it('should be added to the grid', async () => {
      const onAdd = vi.fn();

      render(
        <MuuriGrid onAdd={onAdd}>
          <MuuriItem>
            <div style={{ width: 100, height: 100 }}>Item</div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(onAdd).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      // onAdd should receive an array with the item
      expect(onAdd).toHaveBeenCalledWith(expect.arrayContaining([expect.any(Object)]));
    });

    it('should add multiple items in order', async () => {
      const onAdd = vi.fn();

      render(
        <MuuriGrid onAdd={onAdd}>
          <MuuriItem key="1">
            <div style={{ width: 100, height: 100 }}>Item 1</div>
          </MuuriItem>
          <MuuriItem key="2">
            <div style={{ width: 100, height: 100 }}>Item 2</div>
          </MuuriItem>
          <MuuriItem key="3">
            <div style={{ width: 100, height: 100 }}>Item 3</div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(onAdd).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      // Should have added 3 items
      const addedItems = onAdd.mock.calls[0][0];
      expect(addedItems).toHaveLength(3);
    });
  });

  describe('cleanup on unmount', () => {
    it('should handle item unmount without errors', async () => {
      const onLayoutEnd = vi.fn();

      const { unmount } = render(
        <MuuriGrid onLayoutEnd={onLayoutEnd}>
          <MuuriItem key="1">
            <div style={{ width: 100, height: 100 }}>Item 1</div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(onLayoutEnd).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      // Unmount should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('itemKey prop', () => {
    it('should accept itemKey prop for custom key', () => {
      render(
        <MuuriGrid>
          <MuuriItem itemKey="custom-key" data-testid="item">
            <div>Content</div>
          </MuuriItem>
        </MuuriGrid>
      );

      expect(screen.getByTestId('item')).toBeInTheDocument();
    });
  });
});
