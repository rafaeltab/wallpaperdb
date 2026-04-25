import { AuthenticateWithRedirectCallback } from '@clerk/react';
import { createFileRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';

export const Route = createFileRoute('/sso-callback')({
  component: SSOCallbackPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
});

function buildUrl(path: string): string {
  const basePath = import.meta.env.VITE_BASE_PATH || '';
  const full = `${basePath}${path.startsWith('/') ? '' : '/'}${path}`;
  return full.replace(/\/+/g, '/') || '/';
}

export function SSOCallbackPage() {
  const search = Route.useSearch();
  const redirectUrl = buildUrl(search.redirect || '/');

  return (
    <div className="flex min-h-[calc(100svh-var(--header-height))] items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Signing in...</p>
      </div>
      <AuthenticateWithRedirectCallback
        signInForceRedirectUrl={redirectUrl}
        signUpForceRedirectUrl={redirectUrl}
      />
    </div>
  );
}