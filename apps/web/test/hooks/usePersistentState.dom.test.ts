import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePersistentState } from '@/hooks/usePersistentState';

describe('usePersistentState', () => {
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    // Reset mock storage
    mockStorage = {};

    // Mock localStorage methods
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
      (key: string) => mockStorage[key] || null,
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
      (key: string, value: string) => {
        mockStorage[key] = value;
      },
    );
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(
      (key: string) => {
        delete mockStorage[key];
      },
    );
  });

  describe('Initial State', () => {
    it('returns defaultValue when localStorage is empty', () => {
      const { result } = renderHook(() =>
        usePersistentState('test-key', 'default'),
      );

      expect(result.current[0]).toBe('default');
    });

    it('returns parsed value from localStorage when present', () => {
      mockStorage['test-key'] = JSON.stringify('stored-value');

      const { result } = renderHook(() =>
        usePersistentState('test-key', 'default'),
      );

      expect(result.current[0]).toBe('stored-value');
    });

    it('handles JSON parse errors gracefully (returns defaultValue)', () => {
      mockStorage['test-key'] = 'invalid-json{';

      const { result } = renderHook(() =>
        usePersistentState('test-key', 'default'),
      );

      expect(result.current[0]).toBe('default');
    });

    it('works with complex objects', () => {
      const complexObj = { foo: 'bar', nested: { value: 123 } };
      mockStorage['test-key'] = JSON.stringify(complexObj);

      const { result } = renderHook(() =>
        usePersistentState('test-key', { foo: '', nested: { value: 0 } }),
      );

      expect(result.current[0]).toEqual(complexObj);
    });

    it('works with arrays', () => {
      const arrayValue = [1, 2, 3, 4];
      mockStorage['test-key'] = JSON.stringify(arrayValue);

      const { result } = renderHook(() => usePersistentState('test-key', []));

      expect(result.current[0]).toEqual(arrayValue);
    });

    it('works with boolean values', () => {
      mockStorage['test-key'] = JSON.stringify(true);

      const { result } = renderHook(() => usePersistentState('test-key', false));

      expect(result.current[0]).toBe(true);
    });
  });

  describe('State Updates', () => {
    it('updates state when setState is called', () => {
      const { result } = renderHook(() =>
        usePersistentState('test-key', 'initial'),
      );

      act(() => {
        result.current[1]('updated');
      });

      expect(result.current[0]).toBe('updated');
    });

    it('persists state to localStorage on change', () => {
      const { result } = renderHook(() =>
        usePersistentState('test-key', 'initial'),
      );

      act(() => {
        result.current[1]('persisted');
      });

      expect(mockStorage['test-key']).toBe(JSON.stringify('persisted'));
    });

    it('serializes complex objects correctly', () => {
      const { result } = renderHook(() =>
        usePersistentState<{ name: string; count: number }>('test-key', {
          name: '',
          count: 0,
        }),
      );

      const newValue = { name: 'test', count: 42 };
      act(() => {
        result.current[1](newValue);
      });

      expect(mockStorage['test-key']).toBe(JSON.stringify(newValue));
      expect(result.current[0]).toEqual(newValue);
    });

    it('serializes arrays correctly', () => {
      const { result } = renderHook(() =>
        usePersistentState<number[]>('test-key', []),
      );

      const newArray = [10, 20, 30];
      act(() => {
        result.current[1](newArray);
      });

      expect(mockStorage['test-key']).toBe(JSON.stringify(newArray));
      expect(result.current[0]).toEqual(newArray);
    });

    it('supports functional updates', () => {
      const { result } = renderHook(() =>
        usePersistentState('test-key', 5),
      );

      act(() => {
        result.current[1]((prev) => prev + 10);
      });

      expect(result.current[0]).toBe(15);
      expect(mockStorage['test-key']).toBe(JSON.stringify(15));
    });
  });

  describe('Error Handling', () => {
    it('handles localStorage quota exceeded (falls back to memory-only)', () => {
      const { result } = renderHook(() =>
        usePersistentState('test-key', 'initial'),
      );

      // Simulate quota exceeded error
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      // Should not throw, but state should still update in memory
      act(() => {
        result.current[1]('new-value');
      });

      expect(result.current[0]).toBe('new-value');
    });

    it('handles private browsing mode (localStorage unavailable)', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });

      const { result } = renderHook(() =>
        usePersistentState('test-key', 'default'),
      );

      // Should fall back to default value
      expect(result.current[0]).toBe('default');
    });

    it('does not crash on localStorage.setItem errors', () => {
      const { result } = renderHook(() =>
        usePersistentState('test-key', 'initial'),
      );

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Unknown storage error');
      });

      expect(() => {
        act(() => {
          result.current[1]('new-value');
        });
      }).not.toThrow();

      // State should still update in memory
      expect(result.current[0]).toBe('new-value');
    });
  });

  describe('Multiple Instances', () => {
    it('syncs state across multiple hook instances with same key', () => {
      const { result: result1 } = renderHook(() =>
        usePersistentState('shared-key', 'initial'),
      );
      const { result: result2 } = renderHook(() =>
        usePersistentState('shared-key', 'initial'),
      );

      // Both should start with the same value
      expect(result1.current[0]).toBe('initial');
      expect(result2.current[0]).toBe('initial');

      // Update first instance
      act(() => {
        result1.current[1]('updated');
      });

      // First instance should update
      expect(result1.current[0]).toBe('updated');

      // Second instance starts with initial but can read from storage on re-mount
      const { result: result3 } = renderHook(() =>
        usePersistentState('shared-key', 'initial'),
      );
      expect(result3.current[0]).toBe('updated');
    });

    it('does not interfere with different keys', () => {
      const { result: result1 } = renderHook(() =>
        usePersistentState('key-1', 'value-1'),
      );
      const { result: result2 } = renderHook(() =>
        usePersistentState('key-2', 'value-2'),
      );

      expect(result1.current[0]).toBe('value-1');
      expect(result2.current[0]).toBe('value-2');

      act(() => {
        result1.current[1]('updated-1');
      });

      expect(result1.current[0]).toBe('updated-1');
      expect(result2.current[0]).toBe('value-2'); // Should not change
    });
  });
});
