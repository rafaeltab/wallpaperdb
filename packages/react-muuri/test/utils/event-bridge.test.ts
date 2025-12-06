import { describe, expect, it, vi } from 'vitest';
import type { MuuriEvents, MuuriInstance, MuuriItem } from '../../src/types/index.js';
import {
  createDragEventBridge,
  createVisibilityEventBridge,
} from '../../src/utils/event-bridge.js';

type EmitFunction = (event: keyof MuuriEvents, ...args: unknown[]) => void;

// Mock Muuri grid
function createMockGrid(): MuuriInstance & { _emit: EmitFunction } {
  const listeners: Map<keyof MuuriEvents, Set<(...args: unknown[]) => void>> = new Map();

  const grid = {
    on: vi.fn((event: keyof MuuriEvents, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(listener);
      return grid;
    }),
    off: vi.fn((event: keyof MuuriEvents, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
      return grid;
    }),
    // Helper to emit events in tests
    _emit: (event: keyof MuuriEvents, ...args: unknown[]) => {
      const eventListeners = listeners.get(event);
      if (eventListeners) {
        for (const listener of eventListeners) {
          listener(...args);
        }
      }
    },
    // Minimal mock implementations
    getElement: vi.fn(),
    getItems: vi.fn(() => []),
    add: vi.fn(() => []),
    remove: vi.fn(() => []),
    show: vi.fn(() => grid),
    hide: vi.fn(() => grid),
    filter: vi.fn(() => grid),
    sort: vi.fn(() => grid),
    move: vi.fn(() => grid),
    send: vi.fn(() => grid),
    layout: vi.fn(() => grid),
    refreshItems: vi.fn(() => grid),
    refreshSortData: vi.fn(() => grid),
    synchronize: vi.fn(() => grid),
    destroy: vi.fn(() => grid),
  } as unknown as MuuriInstance & { _emit: EmitFunction };
  return grid;
}

// Mock Muuri item
function createMockItem(id: string): MuuriItem {
  return {
    getElement: vi.fn(() => document.createElement('div')),
    getGrid: vi.fn(),
    getWidth: vi.fn(() => 100),
    getHeight: vi.fn(() => 100),
    getMargin: vi.fn(() => ({ left: 0, right: 0, top: 0, bottom: 0 })),
    getPosition: vi.fn(() => ({ left: 0, top: 0 })),
    isActive: vi.fn(() => true),
    isVisible: vi.fn(() => true),
    isShowing: vi.fn(() => false),
    isHiding: vi.fn(() => false),
    isPositioning: vi.fn(() => false),
    isDragging: vi.fn(() => false),
    isReleasing: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    _id: id,
  } as unknown as MuuriItem;
}

let mockGrid: ReturnType<typeof createMockGrid>;

describe('event-bridge', () => {
  beforeEach(() => {
    mockGrid = createMockGrid();
  });

  describe('createDragEventBridge', () => {
    it('should subscribe to drag events', () => {
      const item = createMockItem('item1');
      const callbacks = {
        onDragStart: vi.fn(),
        onDragEnd: vi.fn(),
        onReleaseStart: vi.fn(),
        onReleaseEnd: vi.fn(),
      };

      createDragEventBridge(mockGrid, item, callbacks);

      expect(mockGrid.on).toHaveBeenCalledWith('dragStart', expect.any(Function));
      expect(mockGrid.on).toHaveBeenCalledWith('dragEnd', expect.any(Function));
      expect(mockGrid.on).toHaveBeenCalledWith('dragReleaseStart', expect.any(Function));
      expect(mockGrid.on).toHaveBeenCalledWith('dragReleaseEnd', expect.any(Function));
    });

    it('should call onDragStart when drag starts for the target item', () => {
      const item = createMockItem('item1');
      const callbacks = {
        onDragStart: vi.fn(),
        onDragEnd: vi.fn(),
        onReleaseStart: vi.fn(),
        onReleaseEnd: vi.fn(),
      };

      createDragEventBridge(mockGrid, item, callbacks);

      // Emit dragStart for this item
      mockGrid._emit('dragStart', item, new MouseEvent('mousedown'));

      expect(callbacks.onDragStart).toHaveBeenCalled();
    });

    it('should NOT call onDragStart for different items', () => {
      const item = createMockItem('item1');
      const otherItem = createMockItem('item2');
      const callbacks = {
        onDragStart: vi.fn(),
        onDragEnd: vi.fn(),
        onReleaseStart: vi.fn(),
        onReleaseEnd: vi.fn(),
      };

      createDragEventBridge(mockGrid, item, callbacks);

      // Emit dragStart for a different item
      mockGrid._emit('dragStart', otherItem, new MouseEvent('mousedown'));

      expect(callbacks.onDragStart).not.toHaveBeenCalled();
    });

    it('should call onDragEnd when drag ends for the target item', () => {
      const item = createMockItem('item1');
      const callbacks = {
        onDragStart: vi.fn(),
        onDragEnd: vi.fn(),
        onReleaseStart: vi.fn(),
        onReleaseEnd: vi.fn(),
      };

      createDragEventBridge(mockGrid, item, callbacks);

      mockGrid._emit('dragEnd', item, new MouseEvent('mouseup'));

      expect(callbacks.onDragEnd).toHaveBeenCalled();
    });

    it('should call onReleaseStart when release starts', () => {
      const item = createMockItem('item1');
      const callbacks = {
        onDragStart: vi.fn(),
        onDragEnd: vi.fn(),
        onReleaseStart: vi.fn(),
        onReleaseEnd: vi.fn(),
      };

      createDragEventBridge(mockGrid, item, callbacks);

      mockGrid._emit('dragReleaseStart', item);

      expect(callbacks.onReleaseStart).toHaveBeenCalled();
    });

    it('should call onReleaseEnd when release ends', () => {
      const item = createMockItem('item1');
      const callbacks = {
        onDragStart: vi.fn(),
        onDragEnd: vi.fn(),
        onReleaseStart: vi.fn(),
        onReleaseEnd: vi.fn(),
      };

      createDragEventBridge(mockGrid, item, callbacks);

      mockGrid._emit('dragReleaseEnd', item);

      expect(callbacks.onReleaseEnd).toHaveBeenCalled();
    });

    it('should return cleanup function that unsubscribes', () => {
      const item = createMockItem('item1');
      const callbacks = {
        onDragStart: vi.fn(),
        onDragEnd: vi.fn(),
        onReleaseStart: vi.fn(),
        onReleaseEnd: vi.fn(),
      };

      const cleanup = createDragEventBridge(mockGrid, item, callbacks);

      expect(cleanup).toBeInstanceOf(Function);

      cleanup();

      expect(mockGrid.off).toHaveBeenCalledWith('dragStart', expect.any(Function));
      expect(mockGrid.off).toHaveBeenCalledWith('dragEnd', expect.any(Function));
      expect(mockGrid.off).toHaveBeenCalledWith('dragReleaseStart', expect.any(Function));
      expect(mockGrid.off).toHaveBeenCalledWith('dragReleaseEnd', expect.any(Function));
    });
  });

  describe('createVisibilityEventBridge', () => {
    it('should subscribe to visibility events', () => {
      const item = createMockItem('item1');
      const callbacks = {
        onShowStart: vi.fn(),
        onShowEnd: vi.fn(),
        onHideStart: vi.fn(),
        onHideEnd: vi.fn(),
      };

      createVisibilityEventBridge(mockGrid, item, callbacks);

      expect(mockGrid.on).toHaveBeenCalledWith('showStart', expect.any(Function));
      expect(mockGrid.on).toHaveBeenCalledWith('showEnd', expect.any(Function));
      expect(mockGrid.on).toHaveBeenCalledWith('hideStart', expect.any(Function));
      expect(mockGrid.on).toHaveBeenCalledWith('hideEnd', expect.any(Function));
    });

    it('should call onShowStart when item starts showing', () => {
      const item = createMockItem('item1');
      const callbacks = {
        onShowStart: vi.fn(),
        onShowEnd: vi.fn(),
        onHideStart: vi.fn(),
        onHideEnd: vi.fn(),
      };

      createVisibilityEventBridge(mockGrid, item, callbacks);

      // Show events pass an array of items
      mockGrid._emit('showStart', [item]);

      expect(callbacks.onShowStart).toHaveBeenCalled();
    });

    it('should NOT call onShowStart for different items', () => {
      const item = createMockItem('item1');
      const otherItem = createMockItem('item2');
      const callbacks = {
        onShowStart: vi.fn(),
        onShowEnd: vi.fn(),
        onHideStart: vi.fn(),
        onHideEnd: vi.fn(),
      };

      createVisibilityEventBridge(mockGrid, item, callbacks);

      mockGrid._emit('showStart', [otherItem]);

      expect(callbacks.onShowStart).not.toHaveBeenCalled();
    });

    it('should return cleanup function', () => {
      const item = createMockItem('item1');
      const callbacks = {
        onShowStart: vi.fn(),
        onShowEnd: vi.fn(),
        onHideStart: vi.fn(),
        onHideEnd: vi.fn(),
      };

      const cleanup = createVisibilityEventBridge(mockGrid, item, callbacks);

      expect(cleanup).toBeInstanceOf(Function);

      cleanup();

      expect(mockGrid.off).toHaveBeenCalledWith('showStart', expect.any(Function));
      expect(mockGrid.off).toHaveBeenCalledWith('showEnd', expect.any(Function));
      expect(mockGrid.off).toHaveBeenCalledWith('hideStart', expect.any(Function));
      expect(mockGrid.off).toHaveBeenCalledWith('hideEnd', expect.any(Function));
    });
  });
});
