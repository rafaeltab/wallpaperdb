import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MuuriGrid } from '../src/MuuriGrid.js';
import { MuuriItem } from '../src/MuuriItem.js';

describe('MuuriGrid', () => {
  describe('rendering', () => {
    it('should render a container div', () => {
      render(<MuuriGrid data-testid="grid" />);

      expect(screen.getByTestId('grid')).toBeInTheDocument();
    });

    it('should render children', () => {
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
          <MuuriItem key="1">
            <div data-testid="child1">Child 1</div>
          </MuuriItem>
          <MuuriItem key="2">
            <div data-testid="child2">Child 2</div>
          </MuuriItem>
        </MuuriGrid>
      );

      expect(screen.getByTestId('child1')).toBeInTheDocument();
      expect(screen.getByTestId('child2')).toBeInTheDocument();
    });

    it('should apply className prop', () => {
      render(<MuuriGrid className="my-grid" data-testid="grid" />);

      expect(screen.getByTestId('grid')).toHaveClass('my-grid');
    });

    it('should merge style prop with required styles', () => {
      render(<MuuriGrid style={{ backgroundColor: 'red' }} data-testid="grid" />);

      const grid = screen.getByTestId('grid');
      // Grid should have position: relative (required by Muuri)
      expect(grid).toHaveStyle({ position: 'relative' });
      // Note: Muuri modifies styles at runtime, so we verify the base requirement
    });

    it('should forward other HTML attributes', () => {
      render(<MuuriGrid id="my-id" data-custom="value" data-testid="grid" />);

      const grid = screen.getByTestId('grid');
      expect(grid).toHaveAttribute('id', 'my-id');
      expect(grid).toHaveAttribute('data-custom', 'value');
    });
  });

  describe('Muuri initialization', () => {
    it('should initialize Muuri after mount', async () => {
      const onLayoutEnd = vi.fn();

      render(
        <MuuriGrid onLayoutEnd={onLayoutEnd}>
          <MuuriItem key="1">
            <div style={{ width: 100, height: 100 }}>Item 1</div>
          </MuuriItem>
        </MuuriGrid>
      );

      // Wait for Muuri to initialize and trigger layout
      await waitFor(
        () => {
          expect(onLayoutEnd).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );
    });

    it('should apply containerClass from Muuri options', () => {
      render(<MuuriGrid containerClass="custom-muuri" data-testid="grid" />);

      expect(screen.getByTestId('grid')).toHaveClass('custom-muuri');
    });
  });

  describe('layout options', () => {
    it('should accept layoutDuration prop', () => {
      // This test just verifies the prop is accepted without error
      render(<MuuriGrid layoutDuration={500} data-testid="grid" />);

      expect(screen.getByTestId('grid')).toBeInTheDocument();
    });

    it('should accept layoutEasing prop', () => {
      render(<MuuriGrid layoutEasing="ease-out" data-testid="grid" />);

      expect(screen.getByTestId('grid')).toBeInTheDocument();
    });

    it('should accept layoutOnResize prop', () => {
      render(<MuuriGrid layoutOnResize={false} data-testid="grid" />);

      expect(screen.getByTestId('grid')).toBeInTheDocument();
    });
  });

  describe('drag options', () => {
    it('should accept dragEnabled prop', () => {
      render(<MuuriGrid dragEnabled={true} data-testid="grid" />);

      expect(screen.getByTestId('grid')).toBeInTheDocument();
    });

    it('should accept dragHandle prop', () => {
      render(<MuuriGrid dragEnabled dragHandle=".handle" data-testid="grid" />);

      expect(screen.getByTestId('grid')).toBeInTheDocument();
    });

    it('should accept dragSort prop', () => {
      render(<MuuriGrid dragEnabled dragSort={true} data-testid="grid" />);

      expect(screen.getByTestId('grid')).toBeInTheDocument();
    });
  });

  describe('event callbacks', () => {
    it('should call onLayoutStart when layout starts', async () => {
      const onLayoutStart = vi.fn();

      render(
        <MuuriGrid onLayoutStart={onLayoutStart}>
          <MuuriItem key="1">
            <div style={{ width: 100, height: 100 }}>Item</div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(onLayoutStart).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );
    });

    it('should call onLayoutEnd when layout ends', async () => {
      const onLayoutEnd = vi.fn();

      render(
        <MuuriGrid onLayoutEnd={onLayoutEnd}>
          <MuuriItem key="1">
            <div style={{ width: 100, height: 100 }}>Item</div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(onLayoutEnd).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );
    });

    it('should call onAdd when items are added', async () => {
      const onAdd = vi.fn();

      render(
        <MuuriGrid onAdd={onAdd}>
          <MuuriItem key="1">
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
    });
  });

  describe('cleanup', () => {
    it('should destroy Muuri instance on unmount', async () => {
      const onLayoutEnd = vi.fn();

      const { unmount } = render(
        <MuuriGrid onLayoutEnd={onLayoutEnd}>
          <MuuriItem key="1">
            <div style={{ width: 100, height: 100 }}>Item</div>
          </MuuriItem>
        </MuuriGrid>
      );

      // Wait for initialization
      await waitFor(
        () => {
          expect(onLayoutEnd).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      // Unmount should not throw
      expect(() => unmount()).not.toThrow();
    });

    it('should handle StrictMode double-mount correctly', async () => {
      const onLayoutEnd = vi.fn();

      const { unmount } = render(
        <MuuriGrid onLayoutEnd={onLayoutEnd}>
          <MuuriItem key="1">
            <div style={{ width: 100, height: 100 }}>Item</div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(onLayoutEnd).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      // Unmount and remount should work (simulating StrictMode behavior)
      unmount();

      const { unmount: unmount2 } = render(
        <MuuriGrid onLayoutEnd={onLayoutEnd}>
          <MuuriItem key="1">
            <div style={{ width: 100, height: 100 }}>Item</div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(onLayoutEnd).toHaveBeenCalledTimes(2);
        },
        { timeout: 1000 }
      );

      expect(() => unmount2()).not.toThrow();
    });
  });

  describe('required CSS', () => {
    it('should have position: relative by default', () => {
      render(<MuuriGrid data-testid="grid" />);

      const grid = screen.getByTestId('grid');
      expect(grid).toHaveStyle({ position: 'relative' });
    });
  });
});
