import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useContext } from 'react';
import { MuuriContext, MuuriProvider } from '../../src/context/MuuriContext.js';
import type { MuuriContextValue } from '../../src/types/index.js';

// Test component to access context
function TestConsumer({ onContext }: { onContext: (ctx: MuuriContextValue | null) => void }) {
  const context = useContext(MuuriContext);
  onContext(context);
  return <div data-testid="consumer">Consumer</div>;
}

describe('MuuriContext', () => {
  describe('default context', () => {
    it('should have null as default value when no provider', () => {
      let capturedContext: MuuriContextValue | null = null;

      render(<TestConsumer onContext={(ctx) => (capturedContext = ctx)} />);

      expect(capturedContext).toBeNull();
    });
  });

  describe('MuuriProvider', () => {
    it('should provide context value to children', () => {
      let capturedContext: MuuriContextValue | null = null;

      render(
        <MuuriProvider>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </MuuriProvider>
      );

      expect(capturedContext).not.toBeNull();
    });

    it('should provide grid as null initially (before initialization)', () => {
      let capturedContext: MuuriContextValue | null = null;

      render(
        <MuuriProvider>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </MuuriProvider>
      );

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.grid).toBeNull();
    });

    it('should provide registerItem function', () => {
      let capturedContext: MuuriContextValue | null = null;

      render(
        <MuuriProvider>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </MuuriProvider>
      );

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.registerItem).toBeInstanceOf(Function);
    });

    it('should provide unregisterItem function', () => {
      let capturedContext: MuuriContextValue | null = null;

      render(
        <MuuriProvider>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </MuuriProvider>
      );

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.unregisterItem).toBeInstanceOf(Function);
    });

    it('should render children', () => {
      render(
        <MuuriProvider>
          <div data-testid="child">Child Content</div>
        </MuuriProvider>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('should render multiple children', () => {
      render(
        <MuuriProvider>
          <div data-testid="child1">Child 1</div>
          <div data-testid="child2">Child 2</div>
        </MuuriProvider>
      );

      expect(screen.getByTestId('child1')).toBeInTheDocument();
      expect(screen.getByTestId('child2')).toBeInTheDocument();
    });
  });

  describe('context shape', () => {
    it('should have correct shape with all required properties', () => {
      let capturedContext: MuuriContextValue | null = null;

      render(
        <MuuriProvider>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </MuuriProvider>
      );

      expect(capturedContext).toMatchObject({
        grid: null,
        registerItem: expect.any(Function),
        unregisterItem: expect.any(Function),
      });
    });
  });
});
