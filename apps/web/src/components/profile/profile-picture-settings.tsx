import { useQuery, useQueryClient } from '@tanstack/react-query';
import { pictureSelection } from '@/features/profile-management';
import { LoaderCircle, Pencil, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { usePictureEditor } from '@/features/picture-editor/adapters/react';
import { ProfilePictureCrop } from '@/components/profile/profile-picture-crop';
import { toast } from 'sonner';
import { ProfileActionButton } from '@/components/profile/profile-action-button';
import { ProfileDialog } from '@/components/profile/profile-dialog';
import { ProfilePicture } from '@/components/profile/profile-picture';
import {
  profileQueryKey,
  useOwnerProfileMutation,
} from '@/features/profile-management/adapters/query';
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
  | { action: 'upload'; picture: File; expectedVersion: number; session: number }
  | { action: 'remove'; expectedVersion: number; session: number };

export function ProfilePictureSettings({
  profile,
  tokenProvider,
}: {
  profile: Profile;
  tokenProvider: () => Promise<string | null>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const dialogContent = useRef<HTMLDivElement>(null);
  const removeOpener = useRef<HTMLButtonElement>(null);
  const editor = usePictureEditor(profile.id);
  const selected = editor.selection;
  const session = useRef(0);
  const client = useQueryClient();
  const ownerQuery = useRef(
    client.getQueryCache().find({ queryKey: profileQueryKey(profile.id), exact: true })
  );
  const [removeVersion, setRemoveVersion] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const policyQuery = useQuery({
    queryKey: [...profileQueryKey(profile.id), 'picture-policy'],
    queryFn: ({ signal }) => userApi.picturePolicy({ signal, tokenProvider }),
    enabled: open,
    retry: false,
  });
  const policy = policyQuery.data;
  const policyReady = Boolean(policy) && !policyQuery.isError && !policyQuery.isFetching;
  const importing =
    profile.pictureImportStatus === 'pending' || profile.pictureImportStatus === 'retrying';
  const {
    mutation,
    refreshing,
    writing,
    availability,
    refresh: refreshProfile,
  } = useOwnerProfileMutation(
    profile.id,
    (command: PictureCommand) => {
      const options = {
        expectedVersion: command.expectedVersion,
        expectedProfileId: profile.id,
        tokenProvider,
      };
      return command.action === 'upload'
        ? userApi.uploadPicture({ ...options, picture: command.picture })
        : userApi.removePicture(options);
    },
    {
      onSuccess: (_updated: Profile, command: PictureCommand) => {
        if (command.session !== session.current) return;
        editor.clear();
        if (input.current) input.current.value = '';
        setError(null);
        setOpen(false);
        toast.success(
          command.action === 'remove' ? 'Generated avatar selected' : 'Profile picture saved'
        );
      },
      onError: (cause) => {
        toast.error('Could not save profile picture', { description: cause.message });
      },
    }
  );
  const feedback =
    error ??
    editor.error ??
    (mutation.error instanceof UserApiError &&
    mutation.error.type?.endsWith('/profile-version-conflict')
      ? 'Your Profile changed elsewhere. Refresh Profile before trying again.'
      : mutation.error?.message);

  async function refresh() {
    if (availability.isBusy()) return;
    mutation.reset();
    setError(null);
    editor.clear();
    if (input.current) input.current.value = '';
    try {
      await refreshProfile();
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
          session.current++;
          if (next)
            ownerQuery.current = client
              .getQueryCache()
              .find({ queryKey: profileQueryKey(profile.id), exact: true });
          if (!next) {
            editor.clear();
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
          {selected?.source && selected.crop && selected.previewUrl ? (
            <ProfilePictureCrop
              source={selected.source}
              crop={selected.crop}
              previewUrl={selected.previewUrl}
              disabled={editor.processing || writing}
              onChange={editor.setCrop}
            />
          ) : (
            <ProfilePicture profile={profile} />
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing || writing || editor.processing}
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
              if (!policy || !policyReady || availability.isBusy() || editor.processing) return;
              const originatingSession = session.current;
              void editor.apply(policy, (picture, expectedVersion) => {
                if (
                  originatingSession !== session.current ||
                  client
                    .getQueryCache()
                    .find({ queryKey: profileQueryKey(profile.id), exact: true }) !==
                    ownerQuery.current
                )
                  return;
                mutation.mutate({
                  picture,
                  expectedVersion,
                  action: 'upload',
                  session: originatingSession,
                });
              });
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
                accept={policy?.acceptedSourceFormats.join(',')}
                disabled={refreshing || writing || !policyReady}
                onChange={(event) => {
                  mutation.reset();
                  setError(null);
                  const picture = event.target.files?.[0];
                  if (!policy || !policyReady) return;
                  const result = pictureSelection(picture, policy.acceptedSourceFormats);
                  setError(result.error);
                  if (result.selected) void editor.choose(result.selected, profile.version);
                  else editor.clear();
                }}
              />
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={refreshing || writing || !policyReady}
                  onClick={() => input.current?.click()}
                >
                  Choose picture
                </Button>
                <span className="min-w-0 break-all text-sm text-muted-foreground">
                  {selected?.file.name ?? 'No picture selected'}
                </span>
              </div>
              <FieldDescription id="picture-limits">
                {policyReady && policy ? (
                  <>
                    {policy.acceptedSourceFormats
                      .map((format) =>
                        format === 'image/webp'
                          ? 'WebP'
                          : format.replace('image/', '').toUpperCase()
                      )
                      .join(', ')}
                    . Up to {formatFileSize(policy.maxOutputBytes)} processed output.{' '}
                    {policy.output.width} × {policy.output.height} WebP, sRGB SDR. Static quality{' '}
                    {policy.encoding.staticQuality}.{' '}
                    {policy.animation.available
                      ? 'Animated images are supported.'
                      : 'Animated images are not supported.'}
                  </>
                ) : (
                  'Loading picture rules…'
                )}
              </FieldDescription>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={!selected || refreshing || writing || editor.processing || !policyReady}
              >
                {mutation.isPending ? 'Saving picture…' : 'Apply'}
              </Button>
              {(profile.pictureAssetId || importing) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={refreshing || writing || editor.processing}
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
          {editor.processing && (
            <output className="flex items-center gap-2 text-sm">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Processing picture…
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Cancel picture processing"
                onClick={editor.cancel}
              >
                <X className="size-4" />
              </Button>
            </output>
          )}
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
                  disabled={refreshing || writing || editor.processing}
                  onClick={() => {
                    if (removeVersion !== null)
                      mutation.mutate({
                        action: 'remove',
                        expectedVersion: removeVersion,
                        session: session.current,
                      });
                  }}
                >
                  Use generated avatar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {policyQuery.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                Unable to load picture rules. Try again before uploading.
              </AlertDescription>
              <Button type="button" variant="outline" onClick={() => void policyQuery.refetch()}>
                Retry picture rules
              </Button>
            </Alert>
          )}
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
