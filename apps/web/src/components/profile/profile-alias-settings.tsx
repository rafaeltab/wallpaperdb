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
import { userApi, type Profile } from '@/lib/api/user';

export function ProfileAliasSettings({
  profile,
  tokenProvider,
}: {
  profile: Profile;
  tokenProvider: () => Promise<string | null>;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ handle: string; expectedVersion: number } | null>(null);
  const [scheduledHandle, setScheduledHandle] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (command: { handle: string; expectedVersion: number }) =>
      userApi.scheduleAliasRemoval({ ...command, expectedProfileId: profile.id, tokenProvider }),
    onSuccess: (updated, command) => {
      queryClient.setQueryData(profileQueryKey(profile.id), updated);
      setScheduledHandle(command.handle);
    },
  });
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
        {scheduledHandle && (
          <Alert role="status">
            <AlertDescription>Removal scheduled for @{scheduledHandle}.</AlertDescription>
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
                      setScheduledHandle(null);
                      setPending({ handle: alias.handle, expectedVersion: profile.version });
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
        <AlertDialog
          open={Boolean(pending)}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Schedule alias removal?</AlertDialogTitle>
              <AlertDialogDescription>
                @{pending?.handle} will expire 24 hours after you confirm. This Profile address will
                redirect until it expires, then stop redirecting to your Profile. It stops counting
                toward your retained limit immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pending) mutation.mutate(pending);
                }}
              >
                Schedule removal
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
