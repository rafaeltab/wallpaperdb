import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAuthNavigation } from '@/features/authentication/adapters/navigation';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

afterEach(() => {
  vi.unstubAllGlobals();
  navigate.mockReset();
  window.history.replaceState(null, '', '/');
});

it('decorates a saved return destination and passes relative URLs to the router', async () => {
  window.history.replaceState(null, '', '/sign-in?redirect=%2Fupload');
  const { result } = renderHook(useAuthNavigation);
  const decorateUrl = vi.fn((url: string) => `${url}?session=ready`);
  await act(() => result.current.finalizeNavigation({ session: null, decorateUrl }));
  expect(decorateUrl).toHaveBeenCalledExactlyOnceWith('/upload');
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ to: '/upload?session=ready' });
});

it('waits for a session task without decorating or navigating', async () => {
  const { result } = renderHook(useAuthNavigation);
  const decorateUrl = vi.fn((url: string) => url);
  await act(() => result.current.finalizeNavigation({ session: { currentTask: { key: 'choose-organization' } }, decorateUrl }));
  expect(decorateUrl).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

it('sends an absolute decorated URL to document navigation', async () => {
  const { result } = renderHook(useAuthNavigation);
  const location = { href: '' };
  // Control the browser navigation boundary, leaving the hook and its policy real.
  vi.stubGlobal('window', { location });
  await act(() => result.current.finalizeNavigation({ decorateUrl: () => 'https://example.test/web/?session=ready' }));
  expect(location.href).toBe('https://example.test/web/?session=ready');
  expect(navigate).not.toHaveBeenCalled();
});
