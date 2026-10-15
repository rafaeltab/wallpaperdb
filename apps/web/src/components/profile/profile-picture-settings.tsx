import { LoaderCircle, Pencil, X } from 'lucide-react';
import { useEffect, useEffectEvent, useRef } from 'react';
import { usePictureEditor } from '@/features/picture-editor/adapters/react';
import { ProfilePictureCrop } from '@/components/profile/profile-picture-crop';
import { ProfileActionButton } from '@/components/profile/profile-action-button';
import { ProfileDialog } from '@/components/profile/profile-dialog';
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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { Profile } from '@/lib/api/user';
import { formatFileSize } from '@/lib/utils/wallpaper';

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
  const { editor, state, policyQuery, policy, policyReady, refreshing, writing, saving } =
    usePictureEditor(profile, tokenProvider);
  const { selection: selected, open, error: feedback, recovery, processing, removeVersion } = state;
  const showPicker = !selected || (!selected.source && !processing);
  const importing =
    profile.pictureImportStatus === 'pending' || profile.pictureImportStatus === 'retrying';
  function selectPicture(picture: File | undefined) {
    void editor.select(picture, policyReady ? policy : undefined);
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
        onOpenChange={(next) => (next ? editor.open() : editor.close())}
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
              disabled={processing || writing}
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
              void editor.apply(policyReady ? policy : undefined);
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
                  disabled={refreshing || writing || processing || recovery === 'required'}
                  onClick={(event) => {
                    removeOpener.current = event.currentTarget;
                    editor.requestRemoval();
                  }}
                >
                  Reset
                </Button>
              )}
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="outline" disabled={writing} onClick={editor.close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !selected ||
                    refreshing ||
                    writing ||
                    processing ||
                    !policyReady ||
                    recovery === 'required'
                  }
                >
                  {saving
                    ? 'Saving picture…'
                    : selected && (feedback || recovery)
                      ? 'Retry'
                      : 'Apply'}
                </Button>
              </div>
            </div>
          </form>
          {processing && (
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
          <AlertDialog
            open={removeVersion !== null}
            onOpenChange={(next) => {
              if (!next) editor.cancelRemoval();
            }}
          >
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
                  disabled={refreshing || writing || processing || recovery === 'required'}
                  onClick={() => void editor.confirmRemoval()}
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
                  onClick={() => void editor.refresh()}
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
