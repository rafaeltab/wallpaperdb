import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Profile } from '@/lib/api/user';

export function ProfileAliasSettings({ profile }: { profile: Profile }) {
  const retained = (profile.aliases ?? []).filter((alias) => !alias.expiresAt);
  const expiring = (profile.aliases ?? []).filter((alias) => alias.expiresAt);

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Previous Profile addresses</CardTitle>
        <CardDescription>
          Your aliases redirect to your current Profile address. Expiring aliases stop counting
          toward your retained limit immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section aria-labelledby="retained-aliases-heading">
          <h2 id="retained-aliases-heading" className="font-medium">
            Retained aliases
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {retained.length} of {profile.retainedAliasLimit ?? 3} retained aliases
          </p>
          {retained.length ? (
            <ul aria-labelledby="retained-aliases-heading" className="mt-3 divide-y">
              {retained.map((alias) => (
                <li key={alias.handle} className="py-3">
                  <p className="break-all font-medium">@{alias.handle}</p>
                  <p className="text-sm text-muted-foreground">Redirects to @{profile.handle}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No retained aliases.</p>
          )}
        </section>
        <section aria-labelledby="expiring-aliases-heading">
          <h2 id="expiring-aliases-heading" className="font-medium">
            Expiring aliases
          </h2>
          {expiring.length ? (
            <ul aria-labelledby="expiring-aliases-heading" className="mt-3 divide-y">
              {expiring.map((alias) => (
                <li key={alias.handle} className="py-3">
                  <p className="break-all font-medium">@{alias.handle}</p>
                  <p className="text-sm text-muted-foreground">
                    Redirect expires at{' '}
                    <time
                      dateTime={alias.expiresAt ?? undefined}
                      title={alias.expiresAt ?? undefined}
                    >
                      {new Date(alias.expiresAt ?? '').toLocaleString()}
                    </time>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No expiring aliases.</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
