import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useContext } from 'react';
import { ItemContext, ItemProvider } from '../../src/context/ItemContext.js';
import type { ItemContextValue } from '../../src/types/index.js';

// Test component to access context
function TestConsumer({ onContext }: { onContext: (ctx: ItemContextValue | null) => void }) {
  const context = useContext(ItemContext);
  onContext(context);
  return <div data-testid="consumer">Consumer</div>;
}

describe('ItemContext', () => {
  describe('default context', () => {
    it('should have null as default value when no provider', () => {
      let capturedContext: ItemContextValue | null = null;

      render(<TestConsumer onContext={(ctx) => (capturedContext = ctx)} />);

      expect(capturedContext).toBeNull();
    });
  });

  describe('ItemProvider', () => {
    it('should provide context value to children', () => {
      let capturedContext: ItemContextValue | null = null;

      render(
        <ItemProvider itemKey="test-key">
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </ItemProvider>
      );

      expect(capturedContext).not.toBeNull();
    });

    it('should provide itemKey from props', () => {
      let capturedContext: ItemContextValue | null = null;

      render(
        <ItemProvider itemKey="my-item-key">
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </ItemProvider>
      );

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.itemKey).toBe('my-item-key');
    });

    it('should provide item as null initially (before Muuri adds it)', () => {
      let capturedContext: ItemContextValue | null = null;

      render(
        <ItemProvider itemKey="test-key">
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </ItemProvider>
      );

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.item).toBeNull();
    });

    it('should render children', () => {
      render(
        <ItemProvider itemKey="test-key">
          <div data-testid="child">Child Content</div>
        </ItemProvider>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('should render multiple children', () => {
      render(
        <ItemProvider itemKey="test-key">
          <div data-testid="child1">Child 1</div>
          <div data-testid="child2">Child 2</div>
        </ItemProvider>
      );

      expect(screen.getByTestId('child1')).toBeInTheDocument();
      expect(screen.getByTestId('child2')).toBeInTheDocument();
    });

    it('should use different itemKeys for different providers', () => {
      const contexts: ItemContextValue[] = [];

      function Capturer({ index }: { index: number }) {
        const context = useContext(ItemContext);
        if (context) contexts[index] = context;
        return null;
      }

      render(
        <>
          <ItemProvider itemKey="key-1">
            <Capturer index={0} />
          </ItemProvider>
          <ItemProvider itemKey="key-2">
            <Capturer index={1} />
          </ItemProvider>
        </>
      );

      expect(contexts[0]?.itemKey).toBe('key-1');
      expect(contexts[1]?.itemKey).toBe('key-2');
    });
  });

  describe('context shape', () => {
    it('should have correct shape with all required properties', () => {
      let capturedContext: ItemContextValue | null = null;

      render(
        <ItemProvider itemKey="test-key">
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </ItemProvider>
      );

      expect(capturedContext).toMatchObject({
        item: null,
        itemKey: 'test-key',
      });
    });
  });
});
