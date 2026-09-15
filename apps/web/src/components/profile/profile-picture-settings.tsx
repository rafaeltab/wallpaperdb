import { useIsFetching, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ProfileActionButton } from '@/components/profile/profile-action-button';
import { ProfileDialog } from '@/components/profile/profile-dialog';
import { ProfilePicture } from '@/components/profile/profile-picture';
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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { type Profile, UserApiError, userApi } from '@/lib/api/user';
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
  const dialogContent = useRef<HTMLDivElement>(null);
  const removeOpener = useRef<HTMLButtonElement>(null);
  const refreshing = useIsFetching({ queryKey: profileQueryKey(profile.id) }) > 0;
  const writing = useIsMutating({ mutationKey: profileQueryKey(profile.id) }) > 0;
  const [selected, setSelected] = useState<{ picture: File; expectedVersion: number } | null>(null);
  const [removeVersion, setRemoveVersion] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!selected) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selected.picture);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selected]);
  const busy = () =>
    queryClient.isFetching({ queryKey: profileQueryKey(profile.id) }) > 0 ||
    queryClient.isMutating({ mutationKey: profileQueryKey(profile.id) }) > 0;
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
    onMutate: () =>
      queryClient.getQueryCache().find({ queryKey: profileQueryKey(profile.id), exact: true }),
    onSuccess: (updated, command, ownerQuery) => {
      if (
        ownerQuery &&
        queryClient.getQueryCache().find({ queryKey: profileQueryKey(profile.id), exact: true }) ===
          ownerQuery
      )
        queryClient.setQueryData(profileQueryKey(profile.id), updated);
      if (!mounted.current) return;
      setSelected(null);
      if (input.current) input.current.value = '';
      setError(null);
      setOpen(false);
      toast.success(
        command.action === 'remove' ? 'Generated avatar selected' : 'Profile picture saved'
      );
    },
    onError: (cause) => {
      if (mounted.current)
        toast.error('Could not save profile picture', { description: cause.message });
    },
  });
  const feedback =
    error ??
    (mutation.error instanceof UserApiError &&
    mutation.error.type?.endsWith('/profile-version-conflict')
      ? 'Your Profile changed elsewhere. Refresh Profile before trying again.'
      : mutation.error?.message);

  async function refresh() {
    if (busy()) return;
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
    <div className="relative w-fit shrink-0">
      <ProfilePicture profile={profile} />
      <ProfileDialog
        ref={dialogContent}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setSelected(null);
            mutation.reset();
            setError(null);
          }
        }}
        title="Profile picture"
        description="Your picture appears on your profile and wallpaper contributions."
        busy={writing}
        trigger={
          <ProfileActionButton
            label="Edit profile picture"
            className="absolute -right-2 -bottom-2"
            buttonClassName="rounded-full border-4 border-card bg-background shadow-sm hover:bg-background dark:hover:bg-background"
          >
            <Pencil className="size-3.5" />
          </ProfileActionButton>
        }
      >
        <div className="space-y-5">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Selected avatar"
              className="size-28 rounded-xl object-cover"
            />
          ) : (
            <ProfilePicture profile={profile} />
          )}
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
              if (selected && !busy()) mutation.mutate({ ...selected, action: 'upload' });
            }}
          >
            <Field>
              <FieldLabel className="sr-only" htmlFor="profile-picture">
                Choose picture
              </FieldLabel>
              <Input
                ref={input}
                id="profile-picture"
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-describedby="picture-limits"
                accept="image/jpeg,image/png,image/webp"
                disabled={refreshing || writing}
                onChange={(event) => {
                  mutation.reset();
                  setError(null);
                  const picture = event.target.files?.[0];
                  if (
                    picture &&
                    !['image/jpeg', 'image/png', 'image/webp'].includes(picture.type)
                  ) {
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
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={refreshing || writing}
                  onClick={() => input.current?.click()}
                >
                  Choose picture
                </Button>
                <span className="min-w-0 break-all text-sm text-muted-foreground">
                  {selected?.picture.name ?? 'No picture selected'}
                </span>
              </div>
              <FieldDescription id="picture-limits">
                JPEG, PNG, or WebP. Up to {formatFileSize(maxBytes)}
                {profile.pictureUploadLimits
                  ? ` and ${(profile.pictureUploadLimits.maxPixels / 1000000).toLocaleString(undefined, { maximumFractionDigits: 6 })} megapixels`
                  : ''}
                . Animated images are not supported.
              </FieldDescription>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!selected || refreshing || writing}>
                {mutation.isPending
                  ? 'Saving picture…'
                  : profile.pictureAssetId
                    ? 'Replace picture'
                    : 'Upload picture'}
              </Button>
              {(profile.pictureAssetId || importing) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={refreshing || writing}
                  onClick={(event) => {
                    removeOpener.current = event.currentTarget;
                    mutation.reset();
                    setRemoveVersion(profile.version);
                    setDialogOpen(true);
                  }}
                >
                  {profile.pictureAssetId ? 'Remove picture' : 'Cancel picture import'}
                </Button>
              )}
            </div>
          </form>
          <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <AlertDialogContent
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (!open) return;
                const opener = removeOpener.current;
                if (opener?.isConnected && !opener.disabled) opener.focus();
                else dialogContent.current?.focus();
              }}
            >
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
                    if (removeVersion !== null && !busy())
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
        </div>
      </ProfileDialog>
    </div>
  );
}
