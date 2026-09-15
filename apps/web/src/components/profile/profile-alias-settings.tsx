import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';

interface AliasCommand {
  action: 'schedule' | 'expire';
  handle: string;
  expectedVersion: number;
}

export function ProfileAliasSettings({
  profile,
  tokenProvider,
}: {
  profile: Profile;
  tokenProvider: () => Promise<string | null>;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<AliasCommand | null>(null);
  const [completed, setCompleted] = useState<AliasCommand | null>(null);
  const mutation = useMutation({
    mutationFn: ({ action, ...command }: AliasCommand) => {
      const options = { ...command, expectedProfileId: profile.id, tokenProvider };
      return action === 'expire'
        ? userApi.expireAlias(options)
        : userApi.scheduleAliasRemoval(options);
    },
    onSuccess: (updated, command) => {
      queryClient.setQueryData(profileQueryKey(profile.id), updated);
      setCompleted(command);
    },
  });
  const retained = (profile.aliases ?? []).filter((alias) => !alias.expiresAt);
  const expiring = (profile.aliases ?? []).filter((alias) => alias.expiresAt);
  const error =
    mutation.error instanceof UserApiError &&
    mutation.error.type?.endsWith('/profile-version-conflict')
      ? `Your Profile changed elsewhere. Reload before ${mutation.variables?.action === 'expire' ? 'expiring' : 'scheduling'} again.`
      : mutation.error?.message;

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
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {completed && (
          <Alert role="status">
            <AlertDescription>
              {completed.action === 'expire'
                ? `@${completed.handle} has expired and no longer redirects to your Profile. Public links may take a moment to update.`
                : `Removal scheduled for @${completed.handle}.`}
            </AlertDescription>
          </Alert>
        )}
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
                <li
                  key={alias.handle}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="break-all font-medium">@{alias.handle}</p>
                    <p className="text-sm text-muted-foreground">Redirects to @{profile.handle}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Schedule removal for @${alias.handle}`}
                    disabled={mutation.isPending}
                    onClick={() => {
                      mutation.reset();
                      setCompleted(null);
                      setPending({
                        action: 'schedule',
                        handle: alias.handle,
                        expectedVersion: profile.version,
                      });
                    }}
                  >
                    Schedule removal
                  </Button>
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
                <li
                  key={alias.handle}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
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
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Expire @${alias.handle} now`}
                    disabled={mutation.isPending}
                    onClick={() => {
                      mutation.reset();
                      setCompleted(null);
                      setPending({
                        action: 'expire',
                        handle: alias.handle,
                        expectedVersion: profile.version,
                      });
                    }}
                  >
                    Expire now
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No expiring aliases.</p>
          )}
        </section>
        <AlertDialog
          open={Boolean(pending)}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pending?.action === 'expire' ? 'Expire alias now?' : 'Schedule alias removal?'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pending?.action === 'expire' ? (
                  <>
                    @{pending.handle} will stop redirecting immediately. This Handle will become
                    available for another User to claim. Existing links using this address will no
                    longer lead to your Profile.
                  </>
                ) : (
                  <>
                    @{pending?.handle} will expire 24 hours after you confirm. This Profile address
                    will redirect until it expires, then stop redirecting to your Profile. It stops
                    counting toward your retained limit immediately.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant={pending?.action === 'expire' ? 'destructive' : 'default'}
                onClick={() => {
                  if (pending) mutation.mutate(pending);
                }}
              >
                {pending?.action === 'expire' ? 'Expire now' : 'Schedule removal'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
