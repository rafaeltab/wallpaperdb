import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Eye, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Profile, userApi } from '@/lib/api/user';
import { ProfileAliasSettings } from './profile-alias-settings';
import { ProfileBiography } from './profile-biography';
import { ProfileDialog } from './profile-dialog';
import { ProfileInlineField } from './profile-inline-field';
import { ProfileOverview } from './profile-overview';
import { ProfilePicture } from './profile-picture';
import { ProfilePictureSettings } from './profile-picture-settings';

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

  return (
    <ProfileEditor
      key={profileQuery.data.id}
      profile={profileQuery.data}
      tokenProvider={getToken}
    />
  );
}

function ProfileEditor({
  profile,
  tokenProvider,
}: {
  profile: Profile;
  tokenProvider: () => Promise<string | null>;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <ProfileOverview
        profile={profile}
        picture={<ProfilePictureSettings profile={profile} tokenProvider={tokenProvider} />}
        identity={
          <>
            <ProfileInlineField
              field="displayName"
              profile={profile}
              tokenProvider={tokenProvider}
            />
            <div className="mt-1">
              <ProfileInlineField field="handle" profile={profile} tokenProvider={tokenProvider} />
            </div>
          </>
        }
        details={<ProfileAliasSettings profile={profile} tokenProvider={tokenProvider} />}
        biographyHeading={false}
        biography={
          <ProfileInlineField
            field="biographyMarkdown"
            profile={profile}
            tokenProvider={tokenProvider}
          />
        }
        actions={
          <ProfileDialog
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            title="Profile preview"
            description="Your saved profile as other people see it."
            className="max-w-4xl"
            trigger={
              <Button type="button" variant="outline" size="sm" className="bg-background/90">
                <Eye className="size-4" />
                View profile
              </Button>
            }
          >
            <ProfileOverview
              profile={profile}
              picture={<ProfilePicture profile={profile} />}
              biography={<ProfileBiography profile={profile} />}
            />
            <div className="mt-5 flex justify-end">
              <Button asChild variant="outline">
                <Link
                  to="/profiles/id/$profileId"
                  params={{ profileId: profile.id }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open your profile
                  <ArrowUpRight className="size-4" />
                </Link>
              </Button>
            </div>
          </ProfileDialog>
        }
      />
    </div>
  );
}
