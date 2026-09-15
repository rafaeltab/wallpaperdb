import { useIsFetching, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Link2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ProfileDialog } from '@/components/profile/profile-dialog';
import {
  historicalHandleUnavailableMessage,
  ProfileHistoricalHandles,
} from '@/components/profile/profile-historical-handles';
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
import { type Profile, UserApiError, userApi } from '@/lib/api/user';

interface AliasCommand {
  action: 'schedule' | 'expire' | 'reactivate' | 'keep';
  handle: string;
  expectedVersion: number;
}

const actionVerbs = {
  schedule: 'scheduling',
  expire: 'expiring',
  reactivate: 'reactivating',
  keep: 'canceling removal',
};

export function ProfileAliasSettings({
  profile,
  tokenProvider,
}: {
  profile: Profile;
  tokenProvider: () => Promise<string | null>;
}) {
  const queryClient = useQueryClient();
  const refreshing = useIsFetching({ queryKey: profileQueryKey(profile.id) }) > 0;
  const profileWritesPending = useIsMutating({ mutationKey: profileQueryKey(profile.id) }) > 0;
  const [pending, setPending] = useState<AliasCommand | null>(null);
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = () =>
    queryClient.isFetching({ queryKey: profileQueryKey(profile.id) }) > 0 ||
    queryClient.isMutating({ mutationKey: profileQueryKey(profile.id) }) > 0;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [completed, setCompleted] = useState<AliasCommand | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationKey: profileQueryKey(profile.id),
    mutationFn: ({ action, ...command }: AliasCommand) => {
      const options = { ...command, expectedProfileId: profile.id, tokenProvider };
      if (action === 'reactivate' || action === 'keep') return userApi.reactivateAlias(options);
      return action === 'expire'
        ? userApi.expireAlias(options)
        : userApi.scheduleAliasRemoval(options);
    },
    onSuccess: (updated, command) => {
      if (queryClient.getQueryState(profileQueryKey(profile.id)))
        queryClient.setQueryData(profileQueryKey(profile.id), updated);
      if (mounted.current) setCompleted(command);
    },
  });
  const retained = (profile.aliases ?? []).filter((alias) => !alias.expiresAt);
  const expiring = (profile.aliases ?? []).filter((alias) => alias.expiresAt);
  const historical = (profile.historicalHandles ?? []).filter(
    (entry) => !profile.aliases?.some((alias) => alias.handle === entry.handle)
  );
  const summary =
    retained.length || expiring.length
      ? `${retained.length} retained${expiring.length ? ` · ${expiring.length} expiring` : ''}`
      : historical.length
        ? `${historical.length} historical`
        : 'No previous handles';
  const error =
    refreshError ??
    (mutation.error instanceof UserApiError &&
    mutation.error.type?.endsWith('/profile-version-conflict')
      ? `Your Profile changed elsewhere. Refresh aliases before ${actionVerbs[mutation.variables?.action ?? 'schedule']} again.`
      : mutation.error?.message);
  const dialog = aliasDialog(pending, profile.handle);

  async function refresh() {
    if (busy()) return;
    mutation.reset();
    setCompleted(null);
    setRefreshError(null);
    try {
      await queryClient.refetchQueries(
        { queryKey: profileQueryKey(profile.id), exact: true },
        { throwOnError: true }
      );
    } catch {
      setRefreshError('Unable to refresh aliases. Try again.');
    }
  }

  return (
    <ProfileDialog
      open={open}
      onOpenChange={setOpen}
      title="Previous handles"
      description="Aliases redirect to your current profile handle. Expiring aliases no longer count toward your retained limit."
      busy={profileWritesPending}
      trigger={
        <button
          type="button"
          aria-label={`Previous handles: ${summary}`}
          className="flex max-w-full items-center gap-1.5 rounded text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Link2 className="size-3.5 shrink-0" />
          <span>{summary === 'No previous handles' ? 'Previous handles' : summary}</span>
          <ChevronRight className="size-3.5 shrink-0" />
        </button>
      }
    >
      <div className="space-y-6">
        <div className="rounded-lg bg-muted/60 px-4 py-3 text-sm">
          Current profile handle <strong className="mt-1 block break-all">@{profile.handle}</strong>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Refresh to see the latest alias status.</p>
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing || profileWritesPending}
            onClick={() => void refresh()}
          >
            Refresh aliases
          </Button>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {completed && (
          <Alert role="status">
            <AlertDescription>
              {completed.action === 'keep'
                ? `Scheduled removal canceled for @${completed.handle}. It is now a retained alias.`
                : completed.action === 'reactivate'
                  ? `@${completed.handle} is now a retained alias. Public links may take a moment to update.`
                  : completed.action === 'expire'
                    ? `@${completed.handle} has expired and no longer redirects to your Profile. Public links may take a moment to update.`
                    : `Removal scheduled for @${completed.handle}.`}
            </AlertDescription>
          </Alert>
        )}
        <section aria-labelledby="retained-aliases-heading">
          <h2
            id="retained-aliases-heading"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Retained aliases
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {retained.length} of {profile.retainedAliasLimit ?? 3} retained aliases
          </p>
          {retained.length ? (
            <ul aria-labelledby="retained-aliases-heading" className="mt-3 space-y-2">
              {retained.map((alias) => (
                <li
                  key={alias.handle}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3"
                >
                  <div>
                    <p className="break-all font-medium">@{alias.handle}</p>
                    <p className="text-sm text-muted-foreground">Redirects to @{profile.handle}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Schedule removal for @${alias.handle}`}
                    disabled={profileWritesPending || refreshing}
                    onClick={() => {
                      mutation.reset();
                      setRefreshError(null);
                      setCompleted(null);
                      setPending({
                        action: 'schedule',
                        handle: alias.handle,
                        expectedVersion: profile.version,
                      });
                      setDialogOpen(true);
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
          <h2
            id="expiring-aliases-heading"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Expiring aliases
          </h2>
          {expiring.length ? (
            <ul aria-labelledby="expiring-aliases-heading" className="mt-3 space-y-2">
              {expiring.map((alias) => {
                const history = profile.historicalHandles?.find(
                  (entry) => entry.handle === alias.handle
                );
                const unavailable = history ? historicalHandleUnavailableMessage(history) : null;
                return (
                  <li
                    key={alias.handle}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3"
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
                      {history && (
                        <p className="text-sm text-muted-foreground">
                          Can cancel removal until{' '}
                          <time dateTime={history.eligibleUntil} title={history.eligibleUntil}>
                            {new Date(history.eligibleUntil).toLocaleString()}
                          </time>
                        </p>
                      )}
                      {unavailable && (
                        <p
                          id={`keep-${alias.handle}-unavailable`}
                          className="mt-1 text-sm text-muted-foreground"
                        >
                          {unavailable}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {history && (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Keep alias @${alias.handle}`}
                          aria-describedby={
                            unavailable ? `keep-${alias.handle}-unavailable` : undefined
                          }
                          disabled={profileWritesPending || refreshing || Boolean(unavailable)}
                          onClick={() => {
                            mutation.reset();
                            setRefreshError(null);
                            setCompleted(null);
                            setPending({
                              action: 'keep',
                              handle: alias.handle,
                              expectedVersion: profile.version,
                            });
                            setDialogOpen(true);
                          }}
                        >
                          Keep alias
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Expire @${alias.handle} now`}
                        disabled={profileWritesPending || refreshing}
                        onClick={() => {
                          mutation.reset();
                          setRefreshError(null);
                          setCompleted(null);
                          setPending({
                            action: 'expire',
                            handle: alias.handle,
                            expectedVersion: profile.version,
                          });
                          setDialogOpen(true);
                        }}
                      >
                        Expire now
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No expiring aliases.</p>
          )}
        </section>
        <ProfileHistoricalHandles
          profile={profile}
          disabled={profileWritesPending || refreshing}
          onReactivate={(handle) => {
            mutation.reset();
            setRefreshError(null);
            setCompleted(null);
            setPending({ action: 'reactivate', handle, expectedVersion: profile.version });
            setDialogOpen(true);
          }}
        />
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
              <AlertDialogDescription>{dialog.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={refreshing || profileWritesPending}
                variant={pending?.action === 'expire' ? 'destructive' : 'default'}
                onClick={() => {
                  if (pending && !busy()) mutation.mutate(pending);
                }}
              >
                {dialog.button}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ProfileDialog>
  );
}

function aliasDialog(command: AliasCommand | null, currentHandle: string) {
  const handle = command?.handle ?? '';
  switch (command?.action) {
    case 'keep':
      return {
        title: 'Keep this alias?',
        description: `Cancel the scheduled removal of @${handle}. It will keep redirecting and use one retained alias slot. Your current Handle will stay @${currentHandle}, and its change cooldown will stay the same.`,
        button: 'Keep alias',
      };
    case 'reactivate':
      return {
        title: 'Reactivate historical Handle?',
        description: `@${handle} will redirect to your Profile and use one retained alias slot. Your current Handle will stay @${currentHandle}, and its change cooldown will stay the same.`,
        button: 'Reactivate alias',
      };
    case 'expire':
      return {
        title: 'Expire alias now?',
        description: `@${handle} will stop redirecting immediately. This Handle will become available for another User to claim. Existing links using this handle will no longer lead to your Profile.`,
        button: 'Expire now',
      };
    default:
      return {
        title: 'Schedule alias removal?',
        description: `@${handle} will expire 24 hours after you confirm. This profile handle will redirect until it expires, then stop redirecting to your Profile. It stops counting toward your retained limit immediately.`,
        button: 'Schedule removal',
      };
  }
}
