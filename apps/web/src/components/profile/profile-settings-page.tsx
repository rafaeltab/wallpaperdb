import { useAuth } from '@clerk/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { ProfileAliasSettings } from '@/components/profile/profile-alias-settings';
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';
import { positiveIntegerEnv } from '@/lib/runtime-config';

const DISPLAY_NAME_MAX_LENGTH = positiveIntegerEnv(
  import.meta.env.VITE_PROFILE_DISPLAY_NAME_MAX_LENGTH,
  80
);

export function ProfileSettingsPage() {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const activeUserId = isLoaded && isSignedIn ? userId : null;
  const profileQuery = useQuery({
    queryKey: profileQueryKey(activeUserId ?? ''),
    queryFn: ({ signal }) =>
      userApi.ensureProfile({
        signal,
        expectedProfileId: activeUserId ?? undefined,
        tokenProvider: getToken,
      }),
    enabled: Boolean(activeUserId),
    staleTime: Infinity,
  });

  if (!isLoaded) return null;
  if (!isSignedIn || !activeUserId) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Sign in to edit your Profile</CardTitle>
            <CardDescription>Profile settings are available to signed-in Users.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/sign-in" search={{ redirect: '/settings/profile' }}>
                Sign in
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!profileQuery.data) {
    if (profileQuery.isError) {
      return (
        <div className="mx-auto max-w-xl px-4 py-12">
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-4">
              Unable to load your Profile.
              <Button variant="outline" size="sm" onClick={() => void profileQuery.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    return (
      <output className="flex min-h-48 items-center justify-center" aria-label="Loading Profile">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </output>
    );
  }

  return <DisplayNameSettings profile={profileQuery.data} tokenProvider={getToken} />;
}

function DisplayNameSettings({
  profile,
  tokenProvider,
}: {
  profile: Profile;
  tokenProvider: () => Promise<string | null>;
}) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: () =>
      userApi.updateProfile({
        displayName,
        expectedVersion: profile.version,
        expectedProfileId: profile.id,
        tokenProvider,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(profileQueryKey(profile.id), updated);
      setError(null);
      setSaved(true);
    },
    onError: (cause) => {
      setSaved(false);
      if (cause instanceof UserApiError && cause.status === 409) {
        setError('Your Profile changed elsewhere. Reload before saving again.');
      } else if (cause instanceof Error) {
        setError(cause.message);
      } else {
        setError('Unable to save the Display name.');
      }
    },
  });

  useEffect(() => {
    setDisplayName(profile.displayName);
  }, [profile.displayName]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    const normalized = displayName.replace(/\s+/gu, ' ').trim();
    if (!normalized) {
      setError('Display name must not be blank.');
      return;
    }
    if ([...normalized].length > DISPLAY_NAME_MAX_LENGTH) {
      setError(`Display name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`);
      return;
    }
    setError(null);
    mutation.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <div className="mb-8 flex items-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <UserRound className="size-6" />
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">@{profile.handle}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Profile settings</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Public identity</CardTitle>
          <CardDescription>Choose the name shown throughout WallpaperDB.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={submit}>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="display-name">Display name</FieldLabel>
              <Input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                aria-invalid={Boolean(error)}
                autoComplete="name"
              />
              <FieldDescription>
                Up to {DISPLAY_NAME_MAX_LENGTH} characters. Repeated whitespace is collapsed when
                saved.
              </FieldDescription>
              {error && <FieldError>{error}</FieldError>}
            </Field>
            {saved && (
              <Alert>
                <AlertDescription>Display name saved.</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" />}
              Save Display name
            </Button>
          </form>
        </CardContent>
      </Card>
      <HandleSettings profile={profile} tokenProvider={tokenProvider} />
      <ProfileAliasSettings profile={profile} tokenProvider={tokenProvider} />
    </div>
  );
}

function HandleSettings({
  profile,
  tokenProvider,
}: {
  profile: Profile;
  tokenProvider: () => Promise<string | null>;
}) {
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState(profile.handle);
  const [saved, setSaved] = useState<'changed' | 'unchanged' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverNextHandleChangeAt, setNextHandleChangeAt] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    handle: string;
    expectedVersion: number;
    aliases: string[];
  } | null>(null);
  const nextChangeTime = serverNextHandleChangeAt
    ? Date.parse(serverNextHandleChangeAt)
    : profile.lastHandleChangedAt
      ? Date.parse(profile.lastHandleChangedAt) + 7 * 24 * 60 * 60 * 1000
      : Number.NaN;
  const nextHandleChangeAt =
    nextChangeTime > Date.now() ? new Date(nextChangeTime).toISOString() : null;
  const mutation = useMutation({
    mutationFn: (command: { handle: string; expectedVersion: number }) =>
      userApi.updateHandle({
        ...command,
        expectedProfileId: profile.id,
        tokenProvider,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(profileQueryKey(profile.id), updated);
      setHandle(updated.handle);
      setSaved(updated.handle === profile.handle ? 'unchanged' : 'changed');
      setError(null);
      setNextHandleChangeAt(null);
    },
    onError: (cause) => {
      if (cause instanceof UserApiError && cause.type?.endsWith('/profile-version-conflict')) {
        setError('Your Profile changed elsewhere. Reload before saving again.');
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to change the Handle.');
      }
      if (cause instanceof UserApiError && cause.nextHandleChangeAt) {
        setNextHandleChangeAt(cause.nextHandleChangeAt);
      }
    },
  });

  useEffect(() => setHandle(profile.handle), [profile.handle]);

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Profile address</CardTitle>
        <CardDescription>
          You can change your Handle once every seven days. Your previous Profile address will
          redirect to your new one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(null);
            setError(null);
            const aliases = aliasesToSchedule(profile, handle);
            const command = { handle, expectedVersion: profile.version };
            if (aliases.length) setPending({ ...command, aliases });
            else mutation.mutate(command);
          }}
        >
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="profile-handle">Handle</FieldLabel>
            <Input
              id="profile-handle"
              value={handle}
              onChange={(event) => {
                setHandle(event.target.value);
                setSaved(null);
              }}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'handle-rules handle-error' : 'handle-rules'}
            />
            <FieldDescription id="handle-rules">
              Use lowercase ASCII letters, numbers, and single hyphens. Spaces and punctuation
              become hyphens. Technical names are reserved.
            </FieldDescription>
            {error && <FieldError id="handle-error">{error}</FieldError>}
          </Field>
          {nextHandleChangeAt && (
            <p className="text-sm text-muted-foreground">
              Next Handle change available:{' '}
              <time dateTime={nextHandleChangeAt}>
                {new Date(nextHandleChangeAt).toLocaleString()}
              </time>
            </p>
          )}
          {saved && (
            <Alert role="status">
              <AlertDescription>
                {saved === 'unchanged' ? (
                  'Handle unchanged.'
                ) : (
                  <>
                    Handle changed to @{profile.handle}. Your previous Profile address will redirect
                    to your new one. Public links may take a moment to update.
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" />}
              Change Handle
            </Button>
            <Button asChild variant="outline">
              <Link to="/profiles/@{$handle}" params={{ handle: profile.handle }}>
                View your Profile
              </Link>
            </Button>
          </div>
        </form>
        <AlertDialog
          open={Boolean(pending)}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change Handle and schedule alias removal?</AlertDialogTitle>
              <AlertDialogDescription>
                Your retained-alias limit is {profile.retainedAliasLimit ?? 3}. Changing your Handle
                will schedule {pending?.aliases.map((alias) => `@${alias}`).join(', ')} for removal.
                These addresses will redirect for 24 hours after confirmation, then expire and stop
                redirecting to your Profile.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pending)
                    mutation.mutate({
                      handle: pending.handle,
                      expectedVersion: pending.expectedVersion,
                    });
                }}
              >
                Confirm Handle change
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function aliasesToSchedule(profile: Profile, requestedHandle: string): string[] {
  const normalized = requestedHandle
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized === profile.handle) return [];

  // The owner response orders aliases oldest first; the former current Handle is newest.
  const retained = (profile.aliases ?? []).filter((alias) => !alias.expiresAt);
  const candidates = [...retained.map((alias) => alias.handle), profile.handle];
  return candidates.slice(0, Math.max(0, candidates.length - (profile.retainedAliasLimit ?? 3)));
}
