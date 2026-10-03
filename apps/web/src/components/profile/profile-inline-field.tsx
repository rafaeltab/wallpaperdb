import { countProfileMarkdownCharacters } from '@wallpaperdb/profile-markdown';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ProfileEditorSnapshot, ProfileField } from '@/features/profile-editor';
import { useProfileEditor } from '@/features/profile-editor/adapters/react';
import type { Profile } from '@/lib/api/user';
import { ProfileActionButton } from './profile-action-button';
import { BiographyMarkdown } from './profile-biography';
import './profile-edit-feedback.css';

type Field = ProfileField;
type Props = { field: Field; profile: Profile; tokenProvider: () => Promise<string | null> };
const labels = {
  displayName: 'display name',
  handle: 'profile handle',
  biographyMarkdown: 'biography',
};

export function ProfileInlineField(props: Props) {
  return <InlineField key={`${props.profile.id}:${props.field}`} {...props} />;
}

function InlineField({ field, profile, tokenProvider }: Props) {
  const errorId = useId();
  const [preview, setPreview] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const { editor, state } = useProfileEditor(field, profile, tokenProvider);
  const { edit, phase, busy } = state;
  const container = useRef<HTMLDivElement>(null);
  const confirmationDialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const availability = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const saveOwnsFocus = useRef(false);
  useEffect(() => {
    function releaseFocusOwnership(event: Event) {
      const target = event.target;
      if (!saveOwnsFocus.current || !(target instanceof Node)) return;
      // Disabling a focused control may send focus to the body without user intent.
      if (event.type === 'focusin' && target === document.body) return;
      if (!container.current?.contains(target) && !confirmationDialog.current?.contains(target)) {
        saveOwnsFocus.current = false;
      }
    }
    document.addEventListener('focusin', releaseFocusOwnership);
    document.addEventListener('pointerdown', releaseFocusOwnership, true);
    return () => {
      saveOwnsFocus.current = false;
      document.removeEventListener('focusin', releaseFocusOwnership);
      document.removeEventListener('pointerdown', releaseFocusOwnership, true);
    };
  }, []);
  const editing = edit !== null;
  useEffect(() => {
    if (editing && !preview)
      (field === 'biographyMarkdown' ? textarea.current : input.current)?.focus();
    else if (
      !editing &&
      (restoreFocus.current || (saveOwnsFocus.current && document.activeElement === document.body))
    ) {
      saveOwnsFocus.current = false;
      restoreFocus.current = false;
      if (opener.current?.disabled) availability.current?.focus();
      else opener.current?.focus();
    }
  }, [editing, field, preview]);
  useEffect(() => {
    if (phase !== 'error' || busy || !saveOwnsFocus.current) return;
    if (document.activeElement !== document.body) {
      saveOwnsFocus.current = false;
      return;
    }
    // Wait for the failed mutation to release the disabled draft before focusing it.
    if (field === 'biographyMarkdown' && preview) {
      setPreview(false);
      return;
    }
    (field === 'biographyMarkdown' ? textarea.current : input.current)?.focus();
    saveOwnsFocus.current = false;
  }, [phase, busy, field, preview]);
  function finish() {
    restoreFocus.current = Boolean(
      container.current?.contains(document.activeElement) ||
        (saveOwnsFocus.current && document.activeElement === document.body)
    );
    saveOwnsFocus.current = false;
    editor.cancel();
  }
  function save(confirmed = false) {
    saveOwnsFocus.current = Boolean(
      container.current?.contains(document.activeElement) ||
        confirmationDialog.current?.contains(document.activeElement)
    );
    return confirmed ? editor.confirmSave() : editor.save();
  }
  const refs = { container, confirmationDialog, input, textarea, opener, availability };
  const actions = <FieldActions field={field} state={state} busy={busy} finish={finish} />;
  const errorNotice = (
    <FieldError state={state} busy={busy} errorId={errorId} refresh={() => void editor.refresh()} />
  );
  const view = {
    field,
    profile,
    editor,
    state,
    refs,
    errorId,
    busy,
    actions,
    errorNotice,
    save,
    finish,
  };
  return field === 'biographyMarkdown' ? (
    <BiographyField
      {...view}
      preview={preview}
      setPreview={setPreview}
      previewRevision={previewRevision}
      refreshPreview={() => setPreviewRevision((revision) => revision + 1)}
    />
  ) : (
    <IdentityField {...view} />
  );
}

type Editor = ReturnType<typeof useProfileEditor>['editor'];
type EditorRefs = {
  container: RefObject<HTMLDivElement | null>;
  confirmationDialog: RefObject<HTMLDivElement | null>;
  input: RefObject<HTMLInputElement | null>;
  textarea: RefObject<HTMLTextAreaElement | null>;
  opener: RefObject<HTMLButtonElement | null>;
  availability: RefObject<HTMLButtonElement | null>;
};
type FieldViewProps = {
  field: Field;
  profile: Profile;
  editor: Editor;
  state: ProfileEditorSnapshot;
  refs: EditorRefs;
  errorId: string;
  busy: boolean;
  actions: ReactNode;
  errorNotice: ReactNode;
  save: (confirmed?: boolean) => void | Promise<void>;
  finish: () => void;
};

function FieldActions({
  field,
  state,
  busy,
  finish,
}: Pick<FieldViewProps, 'field' | 'state' | 'busy' | 'finish'>) {
  const label = labels[field];
  const title = label[0].toUpperCase() + label.slice(1);
  const { phase, locked, canSave } = state;
  const iconSize = field === 'displayName' ? 'size-[1ex]' : 'size-3.5';
  const actionLabel = {
    idle: `Save ${label}`,
    saving: `Saving ${label}`,
    success: `${title} saved`,
    error: `${title} save failed`,
  }[phase];
  return (
    <>
      <output className="sr-only" aria-live="polite">
        {phase === 'idle' ? '' : actionLabel}
      </output>
      <ProfileActionButton
        label={actionLabel}
        type="submit"
        textBaseline={field !== 'biographyMarkdown'}
        buttonClassName={phase === 'idle' ? 'size-6' : 'size-6 disabled:opacity-100'}
        disabled={!canSave || busy}
      >
        {phase === 'saving' ? (
          <Loader2 className={`${iconSize} animate-spin motion-reduce:animate-none`} />
        ) : phase === 'error' ? (
          <X className={`profile-save-feedback ${iconSize}`} data-save-phase={phase} />
        ) : (
          <Check className={`profile-save-feedback ${iconSize}`} data-save-phase={phase} />
        )}
      </ProfileActionButton>
      <ProfileActionButton
        label="Cancel"
        textBaseline={field !== 'biographyMarkdown'}
        buttonClassName="size-6"
        disabled={locked}
        onClick={finish}
      >
        <X className={iconSize} />
      </ProfileActionButton>
    </>
  );
}

function FieldError({
  state,
  busy,
  errorId,
  refresh,
}: {
  state: ProfileEditorSnapshot;
  busy: boolean;
  errorId: string;
  refresh: () => void;
}) {
  const { error, validationError, conflict, locked } = state;
  return (
    <>
      {(error || validationError) && (
        <div role="alert" id={errorId} className="mt-2 w-full text-sm text-destructive">
          {error ?? validationError}
          {conflict && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-2"
              disabled={busy || locked}
              onClick={refresh}
            >
              Refresh profile
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function BiographyField({
  profile,
  editor,
  state,
  refs,
  errorId,
  busy,
  actions,
  errorNotice,
  save,
  finish,
  preview,
  setPreview,
  previewRevision,
  refreshPreview,
}: FieldViewProps & {
  preview: boolean;
  setPreview: (value: boolean) => void;
  previewRevision: number;
  refreshPreview: () => void;
}) {
  const { edit, error, validationError, locked } = state;
  const { container, textarea, opener } = refs;
  const maxCharacters = profile.biographyMaxLength ?? 5000;
  return (
    <div ref={container} className="min-w-0 w-full">
      <section aria-label="Biography" className="w-full min-w-0">
        {edit ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="w-full space-y-3"
          >
            <div className="flex min-h-5 items-center justify-between gap-3">
              <fieldset className="flex gap-2" aria-label="Biography editor mode">
                <Button
                  type="button"
                  variant={preview ? 'ghost' : 'secondary'}
                  size="sm"
                  aria-pressed={!preview}
                  disabled={locked}
                  onClick={() => setPreview(false)}
                >
                  Write
                </Button>
                <Button
                  type="button"
                  variant={preview ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={preview}
                  disabled={locked}
                  onClick={() => setPreview(true)}
                >
                  Preview
                </Button>
              </fieldset>
              <div className="flex gap-1">{actions}</div>
            </div>
            {preview ? (
              <section
                aria-label="Biography preview"
                className="min-h-48 w-full rounded-md border p-3"
              >
                <BiographyMarkdown
                  markdown={edit.value}
                  profileId={profile.id}
                  maxCharacters={maxCharacters}
                  refreshKey={previewRevision}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  disabled={locked}
                  onClick={refreshPreview}
                >
                  Refresh preview
                </Button>
              </section>
            ) : (
              <Textarea
                ref={textarea}
                aria-label="Biography Markdown"
                value={edit.value}
                rows={7}
                className="min-h-48 w-full font-mono text-sm"
                disabled={locked || busy}
                aria-invalid={Boolean(validationError || error)}
                aria-describedby={validationError || error ? errorId : undefined}
                onChange={(event) => editor.change(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !locked) finish();
                }}
              />
            )}
            <p className="text-right text-xs text-muted-foreground">
              {countProfileMarkdownCharacters(edit.value)} / {maxCharacters} characters
            </p>
            {errorNotice}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Formatting help</summary>
              <p className="mt-2 leading-relaxed">
                Use headings, lists, emphasis, tables, and HTTPS links. Embed a published wallpaper
                you own with <code className="break-all">![Alt text](wallpaper:wallpaper-id)</code>.
                New uploads may take a moment to become available.
              </p>
            </details>
          </form>
        ) : (
          <>
            <div className="relative h-5">
              <h2 className="sr-only">Biography</h2>
              <Button
                ref={opener}
                type="button"
                variant="outline"
                size="sm"
                className="absolute -top-1.5 right-0"
                disabled={busy}
                onClick={() => {
                  setPreview(false);
                  editor.beginEdit();
                }}
              >
                <Pencil className="size-3.5" />
                Edit biography
              </Button>
            </div>
            <div className="mt-3">
              <BiographyMarkdown
                markdown={profile.biographyMarkdown}
                profileId={profile.id}
                maxCharacters={maxCharacters}
                refreshKey={profile.version}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function IdentityField({
  field,
  profile,
  editor,
  state,
  refs,
  errorId,
  busy,
  actions,
  errorNotice,
  save,
  finish,
}: FieldViewProps) {
  const label = labels[field];
  const title = label[0].toUpperCase() + label.slice(1);
  const { edit, error, validationError, locked, coolingDown, confirmation, deadline, now } = state;
  const { container, confirmationDialog, input, opener, availability } = refs;
  const editing = edit !== null;
  const typography =
    field === 'displayName'
      ? 'text-3xl font-bold tracking-tight text-card-foreground sm:text-4xl'
      : 'text-base font-normal text-muted-foreground sm:text-lg';
  const iconSize = field === 'displayName' ? 'size-[1ex]' : 'size-3.5';

  return (
    <div
      ref={container}
      className={field === 'handle' ? 'flex min-w-0 flex-wrap items-baseline gap-x-4' : 'min-w-0'}
    >
      <div className="grid min-w-0 max-w-full">
        {editing && (
          <div
            aria-hidden="true"
            className={`pointer-events-none invisible col-start-1 row-start-1 flex min-w-0 items-baseline gap-1 ${typography}`}
          >
            <span className="min-w-0 break-words">
              {field === 'handle' ? '@' : ''}
              {profile[field]}
            </span>
            <span className="w-6 shrink-0">&nbsp;</span>
          </div>
        )}
        <form
          className={`col-start-1 row-start-1 flex min-w-0 max-w-full self-start items-baseline gap-1 ${typography}`}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex min-w-0 items-baseline">
            {field === 'handle' && <span aria-hidden="true">@</span>}
            {edit ? (
              <input
                ref={input}
                aria-label={title}
                aria-invalid={Boolean(validationError || error)}
                aria-describedby={validationError || error ? errorId : undefined}
                className="h-[1lh] min-w-0 max-w-full [field-sizing:content] rounded border-0 bg-transparent p-0 text-[length:inherit] leading-[inherit] tracking-[inherit] outline-none [font-weight:inherit] focus-visible:ring-2 focus-visible:ring-ring"
                value={edit.value}
                disabled={locked || busy}
                autoComplete={field === 'displayName' ? 'name' : 'off'}
                autoCapitalize={field === 'handle' ? 'none' : undefined}
                spellCheck={field === 'handle' ? false : undefined}
                onChange={(event) => editor.change(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !locked) finish();
                }}
              />
            ) : field === 'displayName' ? (
              <h1 className="min-w-0 break-words">{profile.displayName}</h1>
            ) : (
              <p className="min-w-0 break-words">
                <span className="sr-only">@</span>
                {profile.handle}
              </p>
            )}
          </div>
          {edit ? (
            actions
          ) : (
            <ProfileActionButton
              ref={opener}
              label={`Edit ${label}`}
              textBaseline
              buttonClassName="size-6"
              disabled={coolingDown || busy}
              onClick={() => editor.beginEdit()}
            >
              <Pencil className={iconSize} />
            </ProfileActionButton>
          )}
        </form>
      </div>
      {coolingDown && (
        <p className="text-xs text-muted-foreground">
          Available for change in{' '}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                ref={availability}
                type="button"
                className="underline decoration-dotted underline-offset-4"
              >
                <time dateTime={new Date(deadline).toISOString()}>
                  {relativeDeadline(deadline - now)}
                </time>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {new Date(deadline).toLocaleString(undefined, {
                dateStyle: 'full',
                timeStyle: 'long',
              })}
            </TooltipContent>
          </Tooltip>
        </p>
      )}
      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) editor.dismissConfirmation();
        }}
      >
        <AlertDialogContent
          ref={confirmationDialog}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Accepted changes retain their existing save-feedback focus lifecycle.
            if (
              !editor.getSnapshot().locked &&
              input.current?.isConnected &&
              !input.current.disabled
            )
              input.current.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Change profile handle and schedule alias removal?</AlertDialogTitle>
            <AlertDialogDescription>
              Your retained-alias limit is{' '}
              {confirmation?.command.baseProfile.retainedAliasLimit ?? 3}. Changing your profile
              handle will schedule {confirmation?.aliases.map((alias) => `@${alias}`).join(', ')}{' '}
              for removal. These handles will redirect for 24 hours after confirmation, then expire
              and stop redirecting to your profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || coolingDown}
              onClick={() => {
                if (confirmation) void save(true);
              }}
            >
              Confirm handle change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {errorNotice}
    </div>
  );
}

function relativeDeadline(milliseconds: number) {
  const days = Math.ceil(milliseconds / 86_400_000);
  if (days > 1) return `${days} days`;
  const hours = Math.ceil(milliseconds / 3_600_000);
  if (hours > 1) return `${hours} hours`;
  const minutes = Math.ceil(milliseconds / 60_000);
  return minutes > 1 ? `${minutes} minutes` : 'less than a minute';
}
