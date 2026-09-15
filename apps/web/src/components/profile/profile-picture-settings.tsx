import { useIsFetching, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { ProfilePicture } from '@/components/profile/profile-picture';
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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';
import { formatFileSize } from '@/lib/utils/wallpaper';

type PictureCommand =
  | { action: 'upload'; picture: File; expectedVersion: number }
  | { action: 'remove'; expectedVersion: number };

export function ProfilePictureSettings({
  profile,
  tokenProvider,
}: {
  profile: Profile;
  tokenProvider: () => Promise<string | null>;
}) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const refreshing = useIsFetching({ queryKey: profileQueryKey(profile.id) }) > 0;
  const writing = useIsMutating({ mutationKey: profileQueryKey(profile.id) }) > 0;
  const [selected, setSelected] = useState<{ picture: File; expectedVersion: number } | null>(null);
  const [removeVersion, setRemoveVersion] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxBytes = profile.pictureUploadLimits?.maxBytes ?? 5 * 1024 * 1024;
  const importing =
    profile.pictureImportStatus === 'pending' || profile.pictureImportStatus === 'retrying';
  const mutation = useMutation({
    mutationKey: profileQueryKey(profile.id),
    mutationFn: (command: PictureCommand) => {
      const options = {
        expectedVersion: command.expectedVersion,
        expectedProfileId: profile.id,
        tokenProvider,
      };
      return command.action === 'upload'
        ? userApi.uploadPicture({ ...options, picture: command.picture })
        : userApi.removePicture(options);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(profileQueryKey(profile.id), updated);
      setSelected(null);
      if (input.current) input.current.value = '';
      setError(null);
    },
  });
  const feedback =
    error ??
    (mutation.error instanceof UserApiError &&
    mutation.error.type?.endsWith('/profile-version-conflict')
      ? 'Your Profile changed elsewhere. Refresh Profile before trying again.'
      : mutation.error?.message);

  async function refresh() {
    if (refreshing || writing) return;
    mutation.reset();
    setError(null);
    setSelected(null);
    if (input.current) input.current.value = '';
    try {
      await queryClient.refetchQueries(
        { queryKey: profileQueryKey(profile.id), exact: true },
        { throwOnError: true }
      );
    } catch {
      setError('Unable to refresh your Profile. Try again.');
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Profile picture</CardTitle>
        <CardDescription>
          Your picture appears on your Profile and wallpaper contributions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ProfilePicture profile={profile} />
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing || writing}
          onClick={() => void refresh()}
        >
          {refreshing ? 'Refreshing Profile…' : 'Refresh Profile'}
        </Button>
        {importing && (
          <output className="block text-sm text-muted-foreground">
            {profile.pictureImportStatus === 'retrying'
              ? 'Your account picture import is retrying. You can upload a picture or choose your generated avatar now.'
              : 'Importing your account picture. You can keep editing your Profile while it loads.'}
          </output>
        )}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected && !refreshing && !writing)
              mutation.mutate({ ...selected, action: 'upload' });
          }}
        >
          <Field>
            <FieldLabel htmlFor="profile-picture">Choose picture</FieldLabel>
            <Input
              ref={input}
              id="profile-picture"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={refreshing || writing}
              onChange={(event) => {
                mutation.reset();
                setError(null);
                const picture = event.target.files?.[0];
                if (picture && !['image/jpeg', 'image/png', 'image/webp'].includes(picture.type)) {
                  setSelected(null);
                  setError('Choose a JPEG, PNG, or WebP picture.');
                  return;
                }
                if (picture && picture.size > maxBytes) {
                  setSelected(null);
                  setError(`Picture must be at most ${maxBytes.toLocaleString()} bytes.`);
                  return;
                }
                setSelected(picture ? { picture, expectedVersion: profile.version } : null);
              }}
            />
            <FieldDescription>
              JPEG, PNG, or WebP. Up to {formatFileSize(maxBytes)}
              {profile.pictureUploadLimits
                ? ` and ${(profile.pictureUploadLimits.maxPixels / 1000000).toLocaleString(undefined, { maximumFractionDigits: 6 })} megapixels`
                : ''}
              . Animated images are not supported.
            </FieldDescription>
          </Field>
          <Button type="submit" disabled={!selected || refreshing || writing}>
            {mutation.isPending
              ? 'Saving picture…'
              : profile.pictureAssetId
                ? 'Replace picture'
                : 'Upload picture'}
          </Button>
        </form>
        {(profile.pictureAssetId || importing) && (
          <Button
            variant="outline"
            disabled={refreshing || writing}
            onClick={() => {
              mutation.reset();
              setRemoveVersion(profile.version);
              setDialogOpen(true);
            }}
          >
            {profile.pictureAssetId ? 'Remove picture' : 'Cancel picture import'}
          </Button>
        )}
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Use a generated avatar?</AlertDialogTitle>
              <AlertDialogDescription>
                Use your generated avatar and stop any pending picture import. A removed picture
                stops being publicly available as services update.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={refreshing || writing}
                onClick={() => {
                  if (removeVersion !== null && !refreshing && !writing)
                    mutation.mutate({ action: 'remove', expectedVersion: removeVersion });
                }}
              >
                Use generated avatar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {feedback && (
          <Alert variant="destructive">
            <AlertDescription>{feedback}</AlertDescription>
          </Alert>
        )}
        {mutation.isSuccess && (
          <Alert>
            <AlertDescription>
              {mutation.variables?.action === 'remove'
                ? 'Generated avatar selected. Public views may take a moment to update.'
                : 'Picture saved. Public views may take a moment to update.'}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
