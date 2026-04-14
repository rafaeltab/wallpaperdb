import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearTokenProvider, getAuthToken, setTokenProvider } from '@/lib/auth/token-provider';

describe('token-provider', () => {
  afterEach(() => {
    clearTokenProvider();
  });

  it('returns null when no token provider is set', async () => {
    const token = await getAuthToken();
    expect(token).toBeNull();
  });

  it('returns token when provider is set', async () => {
    setTokenProvider(async () => 'test-jwt-token');
    const token = await getAuthToken();
    expect(token).toBe('test-jwt-token');
  });

  it('returns null when provider returns null', async () => {
    setTokenProvider(async () => null);
    const token = await getAuthToken();
    expect(token).toBeNull();
  });

  it('returns null after provider is cleared', async () => {
    setTokenProvider(async () => 'test-jwt-token');
    clearTokenProvider();
    const token = await getAuthToken();
    expect(token).toBeNull();
  });

  it('uses the most recently set provider', async () => {
    setTokenProvider(async () => 'first-token');
    setTokenProvider(async () => 'second-token');
    const token = await getAuthToken();
    expect(token).toBe('second-token');
  });
});