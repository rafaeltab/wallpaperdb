import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

const { ensureProfile, getToken } = vi.hoisted(() => ({
  ensureProfile: vi.fn(),
  getToken: vi.fn(async () => 'test-token'),
}));

vi.mock('@clerk/react', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    getToken,
    isLoaded: true,
    isSignedIn: true,
    userId: 'user_app',
  }),
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({
    user: {
      fullName: 'App User',
      imageUrl: 'https://example.test/avatar.png',
      primaryEmailAddress: null,
    },
  }),
}));

// This test only verifies that the production App tree mounts ProfileBootstrap.
// Stub unrelated providers so their routing, toast, and upload behavior cannot
// turn this focused wiring check into a slow whole-application integration test.
vi.mock('@tanstack/react-query-devtools', () => ({ ReactQueryDevtools: () => null }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createRouter: () => ({}),
  RouterProvider: () => null,
}));
vi.mock('@/components/auth-bridge', () => ({
  AuthBridge: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('@/components/upload/upload-queue-toast-manager', () => ({
  UploadQueueToastManager: () => null,
}));
vi.mock('@/contexts/upload-queue-context', () => ({
  UploadQueueProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/lib/api/user', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/user')>();
  return { ...original, userApi: { ensureProfile } };
});

describe('App', () => {
  beforeEach(() => {
    ensureProfile.mockResolvedValue({
      id: 'user_app',
      handle: 'app-user',
      displayName: 'App User',
      biographyMarkdown: '',
      pictureAssetId: null,
      version: 1,
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
    });
    window.history.pushState({}, '', '/web/');
  });

  it('ensures the signed-in User Profile from the production provider tree', async () => {
    render(<App />);

    await waitFor(() =>
      expect(ensureProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedProfileId: 'user_app',
          tokenProvider: getToken,
        })
      )
    );
  });
});
