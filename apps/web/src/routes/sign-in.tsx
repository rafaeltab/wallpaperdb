import { useAuth } from '@clerk/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { SignInForm } from '@/components/sign-in-form';

export const Route = createFileRoute('/sign-in')({
  component: SignInPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
});

function SignInPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();

  if (isLoaded && isSignedIn) {
    const redirectTo = search.redirect || '/';
    void navigate({ to: redirectTo });
    return null;
  }

  return (
    <div className="flex min-h-[calc(100svh-var(--header-height))]">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <SignInForm />
        </div>
      </div>
      <div className="hidden lg:flex lg:flex-1 bg-muted items-center justify-center">
        <div className="max-w-md text-center px-8">
          <h2 className="text-3xl font-bold mb-4">Welcome back</h2>
          <p className="text-muted-foreground">
            Discover and share beautiful wallpapers with the community
          </p>
        </div>
      </div>
    </div>
  );
}
