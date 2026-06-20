import { ClerkProvider } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { AuthBridge } from '@/components/auth-bridge';
import { ThemeProvider } from '@/components/theme-provider';
import { UploadQueueToastManager } from '@/components/upload/upload-queue-toast-manager';
import { Toaster } from '@/components/ui/sonner';
import { UploadQueueProvider } from '@/contexts/upload-queue-context';
import { routeTree } from './routeTree.gen';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const CLERK_DOMAIN = import.meta.env.VITE_CLERK_DOMAIN?.trim();
const CLERK_IS_SATELLITE = import.meta.env.VITE_CLERK_IS_SATELLITE === 'true';
const CLERK_SIGN_IN_URL = import.meta.env.VITE_CLERK_SIGN_IN_URL?.trim();
const CLERK_SIGN_UP_URL = import.meta.env.VITE_CLERK_SIGN_UP_URL?.trim();
const CLERK_SIGN_IN_FALLBACK_REDIRECT_URL =
  import.meta.env.VITE_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL?.trim();
const CLERK_SIGN_UP_FALLBACK_REDIRECT_URL =
  import.meta.env.VITE_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL?.trim();

function buildAppPath(path: string): string {
  const basePath = import.meta.env.VITE_BASE_PATH || '';
  const normalizedBasePath = basePath === '/' ? '' : basePath.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${normalizedBasePath}${normalizedPath}` || '/';
}

const clerkProviderProps = {
  publishableKey: PUBLISHABLE_KEY!,
  signInUrl: CLERK_SIGN_IN_URL || buildAppPath('/sign-in'),
  signUpUrl: CLERK_SIGN_UP_URL || buildAppPath('/sign-up'),
  signInFallbackRedirectUrl: CLERK_SIGN_IN_FALLBACK_REDIRECT_URL || buildAppPath('/'),
  signUpFallbackRedirectUrl: CLERK_SIGN_UP_FALLBACK_REDIRECT_URL || buildAppPath('/'),
  afterSignOutUrl: buildAppPath('/'),
  ...(CLERK_IS_SATELLITE && CLERK_DOMAIN
    ? { isSatellite: true as const, domain: CLERK_DOMAIN }
    : {}),
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      gcTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createRouter({
  routeTree,
  basepath: import.meta.env.VITE_BASE_PATH || '/',
  context: {
    queryClient,
  },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function App() {
  if (!PUBLISHABLE_KEY) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-destructive mb-2">Configuration Error</h1>
          <p className="text-muted-foreground">
            Missing Clerk publishable key. Set VITE_CLERK_PUBLISHABLE_KEY in your .env file.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider {...clerkProviderProps}>
      <AuthBridge>
        <ThemeProvider defaultTheme="system" storageKey="wallpaperdb-theme">
          <QueryClientProvider client={queryClient}>
            <UploadQueueProvider>
              <RouterProvider router={router} />
              <UploadQueueToastManager />
              <Toaster />
              <ReactQueryDevtools initialIsOpen={false} />
            </UploadQueueProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </AuthBridge>
    </ClerkProvider>
  );
}

export default App;
