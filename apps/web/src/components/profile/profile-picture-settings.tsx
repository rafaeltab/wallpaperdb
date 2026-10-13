import { useQuery, useQueryClient } from '@tanstack/react-query';
import { pictureSelection } from '@/features/profile-management';
import { LoaderCircle, Pencil, X } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
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
  const editor = usePictureEditor(profile.id, profile.pictureUploadLimits);
  const selected = editor.selection;
  const showPicker = !selected || (!selected.source && !editor.processing);
  const session = useRef(0);
  const client = useQueryClient();
  const ownerQuery = useRef(
    client.getQueryCache().find({ queryKey: profileQueryKey(profile.id), exact: true })
  );
  const [removeVersion, setRemoveVersion] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<'required' | 'review' | null>(null);
  useEffect(
    () => () => {
      session.current++;
    },
    []
  );
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
        setRecovery(null);
        setOpen(false);
        toast.success(
          command.action === 'remove' ? 'Generated avatar selected' : 'Profile picture saved'
        );
      },
    }
  );
  function abandonDialog() {
    session.current++;
    editor.clear();
    mutation.reset();
    setError(null);
    setRecovery(null);
    setDialogOpen(false);
    setRemoveVersion(null);
    setOpen(false);
  }
  const checkOwner = useEffectEvent(() => {
    if (
      ownerQuery.current !==
      client.getQueryCache().find({ queryKey: profileQueryKey(profile.id), exact: true })
    )
      abandonDialog();
  });
  useEffect(() => {
    if (!open) return;
    checkOwner();
    return client.getQueryCache().subscribe((event) => {
      if (event.type === 'removed' && event.query === ownerQuery.current) checkOwner();
    });
  }, [open, client]);
  const feedback = error ?? editor.error;
  function currentDialog(originatingSession: number, originatingQuery = ownerQuery.current) {
    return (
      originatingSession === session.current &&
      client.getQueryCache().find({ queryKey: profileQueryKey(profile.id), exact: true }) ===
        originatingQuery
    );
  }
  async function refreshConflict(
    originatingSession: number,
    originatingQuery = ownerQuery.current
  ) {
    if (!currentDialog(originatingSession, originatingQuery) || availability.isBusy()) return;
    try {
      const updated = await refreshProfile();
      if (!currentDialog(originatingSession, originatingQuery)) return;
      editor.setExpectedVersion(updated.version);
      setRecovery('review');
      setError('Your Profile changed elsewhere. Review the latest saved picture before retrying.');
    } catch {
      if (currentDialog(originatingSession, originatingQuery))
        setError(
          'Your Profile changed elsewhere. Unable to refresh your saved Profile. Retry the refresh before saving.'
        );
    }
  }
  async function save(command: PictureCommand) {
    const originatingQuery = ownerQuery.current;
    try {
      await mutation.mutateAsync(command);
    } catch (cause) {
      if (!currentDialog(command.session, originatingQuery)) return;
      if (cause instanceof UserApiError && cause.type?.endsWith('/profile-version-conflict')) {
        editor.setExpectedVersion(null);
        setRecovery('required');
        setError('Your Profile changed elsewhere. Refreshing your saved Profile…');
        await refreshConflict(command.session, originatingQuery);
      } else {
        setError(
          cause instanceof Error ? cause.message : 'Unable to save this picture. Try again.'
        );
      }
    }
  }

  function selectPicture(picture: File | undefined) {
    if (!open || !policy || !policyReady || availability.isBusy()) return;
    mutation.reset();
    setError(null);
    const result = pictureSelection(picture, policy.acceptedSourceFormats);
    setError(result.error);
    if (result.selected)
      void editor.choose(result.selected, recovery === 'required' ? null : profile.version);
    else editor.clear();
  }

  const pastePicture = useEffectEvent((event: ClipboardEvent) => {
    const item = Array.from(event.clipboardData?.items ?? []).find(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    );
    const picture = item?.getAsFile();
    if (!picture) return;
    event.preventDefault();
    selectPicture(picture);
  });
  useEffect(() => {
    if (!open) return;
    document.addEventListener('paste', pastePicture);
    return () => document.removeEventListener('paste', pastePicture);
  }, [open]);

  return (
    <div className="relative w-fit shrink-0">
      <ProfilePicture profile={profile} />
      <ProfileDialog
        ref={dialogContent}
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            abandonDialog();
            return;
          }
          setOpen(true);
          session.current++;
          ownerQuery.current = client
            .getQueryCache()
            .find({ queryKey: profileQueryKey(profile.id), exact: true });
        }}
        title="Profile picture"
        description={showPicker ? 'Choose, drop, or paste an image to begin.' : undefined}
        busy={writing}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const picture = event.dataTransfer.files[0];
          if (picture) selectPicture(picture);
        }}
        trigger={
          <ProfileActionButton
            label="Edit profile picture"
            className="absolute right-1 bottom-1"
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
              if (
                !policy ||
                !policyReady ||
                availability.isBusy() ||
                editor.processing ||
                recovery === 'required'
              )
                return;
              const originatingSession = session.current;
              setError(null);
              mutation.reset();
              void editor.apply(policy, (picture, expectedVersion) => {
                if (!currentDialog(originatingSession)) return;
                if (availability.isBusy())
                  throw new Error(
                    'Your Profile is busy. Apply the picture again after the current change finishes.'
                  );
                void save({
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
                aria-hidden={showPicker ? undefined : true}
                aria-describedby={showPicker ? 'picture-limits' : undefined}
                accept={policy?.acceptedSourceFormats.join(',')}
                disabled={refreshing || writing || !policyReady}
                onChange={(event) => {
                  selectPicture(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {showPicker && (
                <>
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
                      {selected ? selected.file.name : 'No picture selected'}
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
                        {policy.output.width} × {policy.output.height} WebP, sRGB SDR. Static
                        quality {policy.encoding.staticQuality}.{' '}
                        {policy.animation.available
                          ? `GIF animation is supported at quality ${policy.encoding.animationQuality}.`
                          : 'Animated images are not supported.'}
                      </>
                    ) : (
                      'Loading picture rules…'
                    )}
                  </FieldDescription>
                </>
              )}
              {selected && !showPicker && (
                <p className="truncate text-sm text-muted-foreground">{selected.file.name}</p>
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              {(profile.pictureAssetId || importing) && (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={refreshing || writing || editor.processing || recovery === 'required'}
                  onClick={(event) => {
                    removeOpener.current = event.currentTarget;
                    mutation.reset();
                    setRemoveVersion(profile.version);
                    setDialogOpen(true);
                  }}
                >
                  Reset
                </Button>
              )}
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="outline" disabled={writing} onClick={abandonDialog}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !selected ||
                    refreshing ||
                    writing ||
                    editor.processing ||
                    !policyReady ||
                    recovery === 'required'
                  }
                >
                  {mutation.isPending
                    ? 'Saving picture…'
                    : selected && (feedback || recovery)
                      ? 'Retry'
                      : 'Apply'}
                </Button>
              </div>
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
                  disabled={refreshing || writing || editor.processing || recovery === 'required'}
                  onClick={() => {
                    if (removeVersion !== null && recovery !== 'required')
                      void save({
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
          {(feedback || recovery) && (
            <Alert variant="destructive">
              <AlertDescription>
                {feedback ??
                  (recovery === 'required'
                    ? 'Your Profile changed elsewhere. Refresh your saved Profile before retrying.'
                    : 'Your Profile changed elsewhere. Review the latest saved picture before retrying.')}
              </AlertDescription>
              {recovery === 'required' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={refreshing || writing}
                  onClick={() => void refreshConflict(session.current)}
                >
                  {refreshing ? 'Refreshing saved Profile…' : 'Retry Profile refresh'}
                </Button>
              )}
              {recovery === 'review' && (
                <fieldset aria-label="Latest saved picture" className="mt-3 space-y-2">
                  <legend className="text-sm">Latest saved picture</legend>
                  <ProfilePicture profile={profile} />
                </fieldset>
              )}
            </Alert>
          )}
        </div>
      </ProfileDialog>
    </div>
  );
}
