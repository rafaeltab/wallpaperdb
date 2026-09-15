import { useIsFetching, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { ProfilePicture } from '@/components/profile/profile-picture';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { userApi, type Profile } from '@/lib/api/user';

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
  const mutation = useMutation({
    mutationKey: profileQueryKey(profile.id),
    mutationFn: (selection: NonNullable<typeof selected>) =>
      userApi.uploadPicture({
        ...selection,
        expectedProfileId: profile.id,
        tokenProvider,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(profileQueryKey(profile.id), updated);
      setSelected(null);
      if (input.current) input.current.value = '';
    },
  });

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
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected && !refreshing && !writing) mutation.mutate(selected);
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
                const picture = event.target.files?.[0];
                setSelected(picture ? { picture, expectedVersion: profile.version } : null);
              }}
            />
          </Field>
          <Button type="submit" disabled={!selected || refreshing || writing}>
            {mutation.isPending
              ? 'Saving picture…'
              : profile.pictureAssetId
                ? 'Replace picture'
                : 'Upload picture'}
          </Button>
        </form>
        {mutation.error && (
          <Alert variant="destructive">
            <AlertDescription>{mutation.error.message}</AlertDescription>
          </Alert>
        )}
        {mutation.isSuccess && (
          <Alert>
            <AlertDescription>
              Picture saved. Public views may take a moment to update.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
