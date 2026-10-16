import { ArrowLeft, LoaderCircle, Pencil, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
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
import type { Profile } from '@/lib/api/user';
import { cn } from '@/lib/utils';

export function ProfilePictureSettings({
  profile,
  tokenProvider,
}: {
  profile: Profile;
  tokenProvider: () => Promise<string | null>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const dialogContent = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLButtonElement>(null);
  const focusPicker = useRef(false);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const removeOpener = useRef<HTMLButtonElement>(null);
  const { editor, state, policyQuery, policy, policyReady, refreshing, writing, saving } =
    usePictureEditor(profile, tokenProvider);
  const { selection: selected, open, error: feedback, recovery, processing, removeVersion } = state;
  const hasCrop = Boolean(selected?.source && selected.crop && selected.previewUrl);
  const showPicker = !hasCrop;
  const initialRetry = Boolean(selected && !hasCrop && !processing && !saving);
  const stage = saving || (hasCrop && processing) ? 3 : hasCrop ? 2 : 1;
  const clearDrag = useCallback(() => {
    dragDepth.current = 0;
    setDragging(false);
  }, []);
  useEffect(() => {
    if (!open) clearDrag();
    if (showPicker && focusPicker.current) {
      picker.current?.focus();
      focusPicker.current = false;
    }
  }, [open, showPicker, clearDrag]);
  const importing =
    profile.pictureImportStatus === 'pending' || profile.pictureImportStatus === 'retrying';
  function selectPicture(picture: File | undefined) {
    clearDrag();
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
        onOpenChange={(next) => {
          clearDrag();
          if (next) editor.open();
          else editor.close();
        }}
        title="Profile picture"
        busy={writing}
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return;
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          clearDrag();
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
        <div className="space-y-4">
          <ol
            aria-label="Picture editing progress"
            className="flex flex-wrap gap-4 border-b pb-4 text-sm"
          >
            {['Choose', 'Frame', 'Save'].map((label, index) => (
              <li
                key={label}
                aria-current={stage === index + 1 ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 text-muted-foreground',
                  stage === index + 1 && 'font-medium text-foreground'
                )}
              >
                <span
                  className={cn(
                    'flex size-5.5 items-center justify-center rounded-full bg-muted text-xs',
                    stage === index + 1 && 'bg-primary text-primary-foreground'
                  )}
                >
                  {index + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void editor.apply(policyReady ? policy : undefined);
            }}
          >
            <label className="sr-only" htmlFor="profile-picture">
              Choose picture
            </label>
            <input
              ref={input}
              id="profile-picture"
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden={showPicker ? undefined : true}
              aria-describedby={showPicker ? 'picture-formats' : undefined}
              accept={policy?.acceptedSourceFormats.join(',')}
              disabled={refreshing || writing || !policyReady}
              onChange={(event) => {
                selectPicture(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {selected?.source && selected.crop && selected.previewUrl ? (
              <ProfilePictureCrop
                source={selected.source}
                crop={selected.crop}
                previewUrl={selected.previewUrl}
                disabled={processing || writing}
                onChange={editor.setCrop}
              />
            ) : null}
            {showPicker && (
              <fieldset
                aria-label="Picture source"
                className={cn(
                  'flex min-h-58 w-full min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 px-4 py-6 text-center',
                  dragging && 'border-primary bg-primary/10'
                )}
              >
                <Upload aria-hidden="true" className="size-7 text-muted-foreground" />
                <p className="font-medium">
                  {dragging ? 'Drop to edit picture' : 'Drop an image here'}
                </p>
                <Button
                  ref={picker}
                  type="button"
                  variant="outline"
                  aria-describedby="picture-formats"
                  disabled={refreshing || writing || !policyReady}
                  onClick={() => input.current?.click()}
                >
                  Choose picture
                </Button>
                <p className="text-xs text-muted-foreground">
                  Or paste an image from your clipboard
                </p>
                <p id="picture-formats" className="text-xs text-muted-foreground">
                  {policyReady && policy
                    ? new Intl.ListFormat('en-GB', { type: 'disjunction', style: 'short' }).format(
                        policy.acceptedSourceFormats.map((format) =>
                          format === 'image/webp'
                            ? 'WebP'
                            : format.replace('image/', '').toUpperCase()
                        )
                      )
                    : policyQuery.isError
                      ? 'Picture rules unavailable'
                      : 'Loading picture rules…'}
                </p>
              </fieldset>
            )}
            {(importing ||
              processing ||
              saving ||
              policyQuery.isError ||
              feedback ||
              recovery ||
              initialRetry) && (
              <fieldset aria-label="Picture feedback" className="min-w-0 space-y-3">
                {importing && (
                  <p className="text-sm text-muted-foreground">
                    {profile.pictureImportStatus === 'retrying'
                      ? 'Your account picture import is retrying. You can upload a picture or choose your generated avatar now.'
                      : 'Importing your account picture. You can keep editing your Profile while it loads.'}
                  </p>
                )}
                {(processing || saving) && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle
                      className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    <output className="min-w-0 flex-1">
                      {processing ? 'Processing picture…' : 'Saving picture…'}
                    </output>
                    {processing && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Cancel picture processing"
                        onClick={editor.cancel}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                )}
                {policyQuery.isError && (
                  <Alert variant="destructive" className="min-w-0">
                    <AlertDescription>
                      Unable to load picture rules. Try again before uploading.
                    </AlertDescription>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 w-fit max-w-full whitespace-normal"
                      disabled={refreshing || writing || policyQuery.isFetching}
                      onClick={() => void policyQuery.refetch()}
                    >
                      Retry picture rules
                    </Button>
                  </Alert>
                )}
                {(feedback || recovery || initialRetry) && (
                  <Alert variant="destructive" className="min-w-0">
                    <div className="flex min-w-0 items-center gap-3">
                      <AlertDescription className="min-w-0 flex-1 break-words text-destructive/90">
                        {feedback ??
                          (recovery === 'required'
                            ? 'Your Profile changed elsewhere. Refresh your saved Profile before retrying.'
                            : recovery === 'review'
                              ? 'Your Profile changed elsewhere. Review the latest saved picture before retrying.'
                              : 'Picture processing cancelled. Choose a picture or retry.')}
                      </AlertDescription>
                      {initialRetry && (
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          disabled={
                            refreshing || writing || !policyReady || recovery === 'required'
                          }
                          onClick={() => void editor.apply(policyReady ? policy : undefined)}
                        >
                          Retry
                        </Button>
                      )}
                    </div>
                    {recovery === 'required' && (
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-2 w-fit max-w-full whitespace-normal"
                        disabled={refreshing || writing || processing}
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
              </fieldset>
            )}
            <fieldset
              aria-label="Picture actions"
              className="flex min-w-0 flex-wrap items-center gap-2"
            >
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
                {hasCrop ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={processing || refreshing || writing}
                    onClick={() => {
                      if (editor.returnToSelection()) focusPicker.current = true;
                    }}
                  >
                    <ArrowLeft aria-hidden="true" className="size-4" />
                    Back
                  </Button>
                ) : (
                  <Button type="button" variant="outline" disabled={writing} onClick={editor.close}>
                    Cancel
                  </Button>
                )}
                <Button
                  type="submit"
                  aria-label={saving ? 'Apply' : undefined}
                  disabled={
                    !hasCrop ||
                    refreshing ||
                    writing ||
                    processing ||
                    !policyReady ||
                    recovery === 'required'
                  }
                >
                  {saving
                    ? 'Saving picture…'
                    : hasCrop && (feedback || recovery)
                      ? 'Retry'
                      : 'Apply'}
                </Button>
              </div>
            </fieldset>
          </form>
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
        </div>
      </ProfileDialog>
    </div>
  );
}
