import { useAuth } from '@clerk/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
    </div>
  );
}
