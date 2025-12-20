import { useEffect, useState } from 'react';

/**
 * React hook that persists state to localStorage with JSON serialization.
 * 
 * @param key - localStorage key
 * @param defaultValue - Default value if localStorage is empty or parsing fails
 * @returns Tuple of [state, setState] similar to useState
 */
export function usePersistentState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  // Initialize state from localStorage or default value
  const [state, setState] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      // If JSON parse fails or localStorage is unavailable, return default
      console.warn(`Failed to parse localStorage key "${key}":`, error);
      return defaultValue;
    }
  });

  // Persist to localStorage whenever state changes
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      // Handle quota exceeded or private browsing mode
      console.warn(`Failed to save to localStorage key "${key}":`, error);
    }
  }, [key, state]);

  return [state, setState];
}
