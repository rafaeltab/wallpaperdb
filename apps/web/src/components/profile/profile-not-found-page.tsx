import { Link } from '@tanstack/react-router';
import { UserRoundX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ProfileNotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-12 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
        <UserRoundX className="size-8 text-muted-foreground" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">Profile not found</h1>
      <p className="mt-2 text-muted-foreground">
        This Profile does not exist, or its Handle is no longer available.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link to="/">Back to gallery</Link>
      </Button>
    </div>
  );
}
