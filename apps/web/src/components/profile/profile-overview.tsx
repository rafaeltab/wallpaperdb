import type { ReactNode } from 'react';
import type { Profile } from '@/lib/graphql/types';

export function ProfileOverview({
  profile,
  picture,
  biography,
  actions,
  identity,
  details,
}: {
  profile: Pick<Profile, 'displayName' | 'handle'>;
  picture: ReactNode;
  biography: ReactNode;
  actions?: ReactNode;
  identity?: ReactNode;
  details?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="relative h-24 bg-linear-to-r from-primary/20 via-primary/10 to-transparent sm:h-32">
        {actions && <div className="absolute top-4 right-4">{actions}</div>}
      </div>
      <div className="px-5 pb-7 sm:px-8 sm:pb-9">
        <div className="relative -mt-12 flex flex-col gap-5 sm:-mt-14 sm:flex-row sm:items-end sm:gap-7">
          {picture}
          <div className="min-w-0 flex-1 pb-1">
            {identity ?? (
              <>
                <h1 className="break-words text-3xl font-bold tracking-tight text-card-foreground sm:text-4xl">
                  {profile.displayName}
                </h1>
                <p className="mt-1 break-all text-base text-muted-foreground sm:text-lg">
                  @{profile.handle}
                </p>
              </>
            )}
          </div>
          {details && (
            <div className="absolute top-full left-0 mt-2 max-w-full sm:left-35">{details}</div>
          )}
        </div>

        <div className="mt-8 border-t pt-6">
          <div className="min-w-0">{biography}</div>
        </div>
      </div>
    </section>
  );
}
