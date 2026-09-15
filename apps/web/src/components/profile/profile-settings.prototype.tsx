// THROWAWAY: five Profile settings layouts on /settings/profile?variant=A|B|C|D|E.
// All edits stay in React state. Delete after the design decision; do not promote as-is.
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, Check, ChevronRight, Clock3, Link2, Pencil, Upload, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BiographyMarkdown } from '@/components/profile/profile-biography';
import { ProfilePictureImage } from '@/components/profile/profile-picture';
import { ProfileOverview } from '@/components/profile/public-profile-page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PrototypeIconButton } from '@/components/ui/prototype-icon-button';
import { PrototypeSwitcher } from '@/components/ui/prototype-switcher';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Profile } from '@/lib/api/user';

type Variant = 'A' | 'B' | 'C' | 'D' | 'E';
const HANDLE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
function relativeAvailability(remainingMs: number) {
  if (remainingMs < 60_000) return 'less than a minute';
  const [duration, unit] =
    remainingMs >= 86400000
      ? ([86400000, 'day'] as const)
      : remainingMs >= 3600000
        ? ([3600000, 'hour'] as const)
        : ([60000, 'minute'] as const);
  const count = Math.ceil(remainingMs / duration);
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}
type BiographyEdit = { draft: string; preview: boolean };
type Editor = 'picture' | 'biography' | 'name' | 'aliases' | 'public' | null;
type PreviousHandle = {
  handle: string;
  status: 'retained' | 'expiring' | 'historical';
  expiresAt?: string | null;
  eligibleUntil?: string;
  unavailableReason?: string | null;
};
type DraftProfile = {
  name: string;
  handle: string;
  biography: string;
  picture: string | null;
  aliases: PreviousHandle[];
  retainedLimit: number;
  nextHandleChangeAt: string | null;
};

function initialProfile(profile: Profile): DraftProfile {
  const nextChange = Date.parse(profile.lastHandleChangedAt ?? '') + HANDLE_COOLDOWN_MS;
  return {
    name: profile.displayName,
    handle: profile.handle,
    biography: profile.biographyMarkdown,
    retainedLimit: profile.retainedAliasLimit ?? 3,
    nextHandleChangeAt: nextChange > Date.now() ? new Date(nextChange).toISOString() : null,
    picture: profile.pictureAssetId
      ? `${(import.meta.env.VITE_MEDIA_URL || '/media').replace(/\/+$/, '')}/profile-pictures/${encodeURIComponent(profile.pictureAssetId)}`
      : null,
    aliases: [
      ...(profile.aliases ?? []).map((alias) => ({
        handle: alias.handle,
        status: alias.expiresAt ? ('expiring' as const) : ('retained' as const),
        expiresAt: alias.expiresAt,
      })),
      ...(profile.historicalHandles ?? [])
        .filter(
          (alias) =>
            alias.handle !== profile.handle &&
            !profile.aliases?.some((active) => active.handle === alias.handle)
        )
        .map((alias) => ({
          handle: alias.handle,
          status: 'historical' as const,
          eligibleUntil: alias.eligibleUntil,
          unavailableReason: alias.unavailableReason,
        })),
    ],
  };
}

export default function ProfileSettingsPrototype({
  profile,
  variant,
}: {
  profile: Profile;
  variant: Variant;
}) {
  const navigate = useNavigate({ from: '/settings/profile' });
  const [value, setValue] = useState(() => initialProfile(profile));
  const [handle, setHandle] = useState(value.handle);
  const [inlineDrafts, setInlineDrafts] = useState<{ name: string | null; handle: string | null }>({
    name: null,
    handle: null,
  });
  const [editor, setEditor] = useState<Editor>(null);
  const [biographyEdit, setBiographyEdit] = useState<BiographyEdit | null>(null);
  const biographyEditButton = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const handleLocked = Boolean(
    value.nextHandleChangeAt && Date.parse(value.nextHandleChangeAt) > now
  );
  const opener = useRef<HTMLElement | null>(null);
  function openEditor(next: Editor) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditor(next);
  }
  function update(patch: Partial<DraftProfile>, message: string) {
    setValue((current) => ({ ...current, ...patch }));
    toast.success(message);
    setEditor(null);
  }
  function startBiographyEdit() {
    if (variant === 'D' || variant === 'E') {
      setBiographyEdit({ draft: value.biography, preview: false });
    } else openEditor('biography');
  }
  function finishBiographyEdit() {
    setBiographyEdit(null);
    requestAnimationFrame(() => biographyEditButton.current?.focus());
  }
  const retained = value.aliases.filter((alias) => alias.status === 'retained').length;
  const expiring = value.aliases.filter((alias) => alias.status === 'expiring').length;
  const historical = value.aliases.filter((alias) => alias.status === 'historical').length;
  const aliasSummary =
    retained || expiring
      ? `${retained} retained${expiring ? ` · ${expiring} expiring` : ''}`
      : historical
        ? `${historical} previous ${historical === 1 ? 'handle' : 'handles'}`
        : 'No previous handles';
  const dirtyHandle = handle !== value.handle;
  const validHandle = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle);

  const avatar = (
    <div className="relative w-fit shrink-0">
      {variant === 'E' ? (
        <ProfilePictureImage
          key={value.picture ?? 'generated'}
          profile={{
            id: profile.id,
            displayName: value.name,
            picture: value.picture ? { id: 'prototype-picture', url: value.picture } : null,
          }}
        />
      ) : (
        <Avatar value={value} />
      )}
      <PrototypeIconButton
        className="absolute -right-2 -bottom-2"
        buttonClassName="rounded-full border-4 border-card bg-background shadow-sm hover:bg-background dark:hover:bg-background"
        label="Edit profile picture"
        onClick={() => openEditor('picture')}
      >
        <Pencil className="size-3.5" />
      </PrototypeIconButton>
    </div>
  );
  const name = (
    <div className="flex min-w-0 items-baseline gap-2">
      <h2 className="min-w-0 break-words text-2xl font-semibold tracking-tight sm:text-3xl">
        {value.name}
      </h2>
      <PrototypeIconButton
        label="Edit display name"
        textBaseline
        className="text-2xl sm:text-3xl"
        onClick={() => openEditor('name')}
      >
        <Pencil className="size-[1ex]" />
      </PrototypeIconButton>
    </div>
  );
  const aliases = (
    <button
      type="button"
      aria-label={`Previous handles: ${aliasSummary}`}
      className="flex max-w-full items-center gap-1.5 rounded text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() => openEditor('aliases')}
    >
      <Link2 className="size-3.5 shrink-0" />
      <span>
        {variant === 'E' ? (
          retained || expiring || historical ? (
            aliasSummary
          ) : (
            'Previous handles'
          )
        ) : (
          <>
            Previous handles <span aria-hidden="true">·</span> {aliasSummary}
          </>
        )}
      </span>
      <ChevronRight className="size-3.5 shrink-0" />
    </button>
  );
  const handleField = (
    <div className="min-w-0 space-y-2.5">
      <label htmlFor="prototype-handle" className="block text-sm font-medium">
        Profile handle
      </label>
      <div className="relative max-w-md">
        <span className="pointer-events-none absolute top-2.5 left-3 text-sm text-muted-foreground">
          @
        </span>
        <Input
          id="prototype-handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          className="h-10 pl-8"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={dirtyHandle ? 'prototype-handle-help' : undefined}
        />
      </div>
      {dirtyHandle && (
        <div className="max-w-md space-y-3">
          <p id="prototype-handle-help" className="text-xs leading-5 text-muted-foreground">
            You can change your handle once every seven days. @{value.handle} will redirect to your
            new handle.
          </p>
          {!validHandle && (
            <p role="alert" className="text-xs text-destructive">
              Use lowercase letters, numbers, and single hyphens.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!validHandle}
              onClick={() =>
                update(
                  {
                    handle,
                    aliases: [
                      { handle: value.handle, status: 'retained' },
                      ...value.aliases.filter((alias) => alias.handle !== handle),
                    ],
                  },
                  'Profile handle updated'
                )
              }
            >
              Save handle
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setHandle(value.handle)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {aliases}
    </div>
  );
  const biography =
    variant === 'E' ? (
      <section className="min-w-0 max-w-3xl">
        <div className="relative h-5">
          <h2 className="sr-only">Biography</h2>
          {!biographyEdit && (
            <Button
              ref={biographyEditButton}
              className="absolute -top-1.5 right-0"
              variant="outline"
              size="sm"
              onClick={startBiographyEdit}
            >
              <Pencil className="size-3.5" />
              Edit biography
            </Button>
          )}
        </div>
        <div className="mt-3 min-w-0 max-w-3xl">
          {biographyEdit ? (
            <BiographyEditor
              value={value}
              profile={profile}
              inline
              compact
              edit={biographyEdit}
              onEdit={setBiographyEdit}
              update={(patch, message) => {
                update(patch, message);
                finishBiographyEdit();
              }}
              cancel={finishBiographyEdit}
            />
          ) : (
            <BiographyMarkdown markdown={value.biography} profileId={profile.id} />
          )}
        </div>
      </section>
    ) : (
      <section className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-medium">Biography</h3>
          {!(variant === 'D' && biographyEdit) && (
            <Button
              ref={biographyEditButton}
              variant="outline"
              size="sm"
              onClick={startBiographyEdit}
            >
              <Pencil className="size-3.5" />
              Edit biography
            </Button>
          )}
        </div>
        {variant === 'D' && biographyEdit ? (
          <BiographyEditor
            value={value}
            profile={profile}
            inline
            edit={biographyEdit}
            onEdit={setBiographyEdit}
            update={(patch, message) => {
              update(patch, message);
              finishBiographyEdit();
            }}
            cancel={finishBiographyEdit}
          />
        ) : value.biography.trim() ? (
          <BiographyMarkdown markdown={value.biography} profileId={profile.id} />
        ) : (
          <button
            className="w-full rounded-lg border border-dashed p-5 text-left text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground"
            type="button"
            onClick={startBiographyEdit}
          >
            A little about you, and the wallpapers you love.
            <span className="mt-2 block font-medium text-foreground">
              Add a biography <span aria-hidden="true">→</span>
            </span>
          </button>
        )}
      </section>
    );
  const parts = { avatar, name, handleField, biography, aliases };
  const inlineName = (
    <InlineProfileText
      kind="name"
      appearance={variant === 'E' ? 'profile' : 'settings'}
      value={value.name}
      draft={inlineDrafts.name}
      onDraft={(draft) => setInlineDrafts((current) => ({ ...current, name: draft }))}
      onSave={(name) => {
        update({ name }, 'Display name updated');
        setInlineDrafts((current) => ({ ...current, name: null }));
      }}
    />
  );
  const inlineHandle = (
    <div className="min-w-0 space-y-3">
      <InlineProfileText
        kind="handle"
        appearance={variant === 'E' ? 'profile' : 'settings'}
        disabled={handleLocked}
        disabledHintId="prototype-handle-cooldown"
        disabledNotice={
          handleLocked &&
          value.nextHandleChangeAt && (
            <span
              id="prototype-handle-cooldown"
              tabIndex={-1}
              className="text-xs leading-5 text-muted-foreground focus:outline-none"
            >
              Available for change in{' '}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="cursor-help underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <time dateTime={value.nextHandleChangeAt}>
                      {relativeAvailability(Date.parse(value.nextHandleChangeAt) - now)}
                    </time>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={6}
                  collisionPadding={16}
                  className="max-w-[calc(100vw-2rem)] sm:max-w-xs"
                >
                  {new Date(value.nextHandleChangeAt).toLocaleString(undefined, {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'long',
                  })}
                </TooltipContent>
              </Tooltip>
            </span>
          )
        }
        value={value.handle}
        draft={inlineDrafts.handle}
        onDraft={(draft) => setInlineDrafts((current) => ({ ...current, handle: draft }))}
        onSave={(handle) => {
          const changedAt = Date.now();
          setNow(changedAt);
          update(
            {
              handle,
              nextHandleChangeAt: new Date(changedAt + HANDLE_COOLDOWN_MS).toISOString(),
              aliases: [
                { handle: value.handle, status: 'retained' },
                ...value.aliases.filter((alias) => alias.handle !== handle),
              ],
            },
            'Profile handle updated'
          );
          setHandle(handle);
          setInlineDrafts((current) => ({ ...current, handle: null }));
        }}
      />
      {variant !== 'E' && aliases}
    </div>
  );
  return (
    <>
      <div
        className={
          variant === 'E'
            ? 'mx-auto w-full max-w-5xl px-4 pt-8 pb-48 sm:px-6 sm:pt-12 lg:px-8'
            : `mx-auto px-4 pt-8 pb-48 sm:px-8 sm:pt-12 ${variant === 'B' || variant === 'D' ? 'max-w-4xl' : 'max-w-3xl'}`
        }
      >
        {variant !== 'E' && (
          <header className="mb-7 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Your profile</h1>
              <p className="mt-1 text-sm text-muted-foreground">How you appear on WallpaperDB.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => openEditor('public')}>
              View profile
              <ArrowUpRight className="size-4" />
            </Button>
          </header>
        )}
        {variant === 'A' ? (
          <VariantA {...parts} />
        ) : variant === 'B' ? (
          <VariantB {...parts} />
        ) : variant === 'C' ? (
          <VariantC {...parts} />
        ) : variant === 'D' ? (
          <VariantD {...parts} name={inlineName} handleField={inlineHandle} />
        ) : (
          <VariantE
            {...parts}
            name={inlineName}
            handleField={inlineHandle}
            viewProfile={() => openEditor('public')}
          />
        )}
      </div>
      <PrototypeModal editor={editor} close={() => setEditor(null)} opener={opener.current}>
        {editor === 'picture' && (
          <PictureEditor value={value} update={update} cancel={() => setEditor(null)} />
        )}
        {editor === 'biography' && (
          <BiographyEditor
            value={value}
            profile={profile}
            update={update}
            cancel={() => setEditor(null)}
          />
        )}
        {editor === 'name' && (
          <NameEditor value={value} update={update} cancel={() => setEditor(null)} />
        )}
        {editor === 'aliases' && (
          <AliasesEditor
            value={value}
            onChange={(aliases) => setValue((current) => ({ ...current, aliases }))}
          />
        )}
        {editor === 'public' && (
          <div>
            <ProfileOverview
              profile={{ displayName: value.name, handle: value.handle }}
              picture={
                <ProfilePictureImage
                  profile={{
                    id: profile.id,
                    displayName: value.name,
                    picture: value.picture ? { id: 'prototype-picture', url: value.picture } : null,
                  }}
                />
              }
              biography={<BiographyMarkdown markdown={value.biography} profileId={profile.id} />}
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
          </div>
        )}
      </PrototypeModal>
      <PrototypeSwitcher
        variant={variant}
        modalOpen={editor !== null}
        extraControls={
          (variant === 'D' || variant === 'E') && (
            <Button
              type="button"
              variant={handleLocked ? 'secondary' : 'ghost'}
              size="xs"
              aria-label="Preview handle cooldown"
              aria-pressed={handleLocked}
              onClick={() => {
                const previewNow = Date.now();
                setNow(previewNow);
                setValue((current) => ({
                  ...current,
                  nextHandleChangeAt: handleLocked
                    ? null
                    : new Date(previewNow + HANDLE_COOLDOWN_MS).toISOString(),
                }));
                setInlineDrafts((current) => ({ ...current, handle: null }));
              }}
            >
              <Clock3 />
              Cooldown
            </Button>
          )
        }
        onChange={(next) =>
          void navigate({ search: { variant: next }, replace: true, resetScroll: false })
        }
        onReset={() => {
          const fresh = initialProfile(profile);
          setValue(fresh);
          setHandle(fresh.handle);
          setInlineDrafts({ name: null, handle: null });
          setBiographyEdit(null);
        }}
        onExample={() => {
          setValue((current) => ({
            ...current,
            biography:
              'Collecting quiet landscapes, thoughtful architecture, and the occasional splash of colour.\n\nMostly here for **the details**.',
            aliases: [
              { handle: 'rafael-bieze', status: 'retained' },
              {
                handle: 'rafael-archive',
                status: 'expiring',
                expiresAt: new Date(Date.now() + 86400000).toISOString(),
              },
              {
                handle: 'rafael-design',
                status: 'historical',
                eligibleUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
              },
            ],
          }));
          toast.info('Example biography and previous handles loaded');
        }}
        state={{
          ...value,
          picture: value.picture ? 'Picture set' : 'Generated initials',
          handleDraft: handle,
          inlineDrafts,
          biographyEdit,
          editor,
        }}
      />
    </>
  );
}

type Parts = {
  avatar: ReactNode;
  name: ReactNode;
  handleField: ReactNode;
  biography: ReactNode;
  aliases: ReactNode;
};
export function VariantA({ avatar, name, handleField, biography }: Parts) {
  return (
    <div className="rounded-2xl border bg-card p-5 sm:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-7">
        <div className="pt-1">{avatar}</div>
        <div className="min-w-0 flex-1 space-y-5">
          {name}
          {handleField}
        </div>
      </div>
      <div className="mt-7 border-t pt-5">{biography}</div>
    </div>
  );
}
export function VariantB({ avatar, name, handleField, biography }: Parts) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="h-28 bg-gradient-to-br from-primary/20 via-primary/5 to-muted sm:h-36" />
      <div className="px-5 pb-7 sm:px-9 sm:pb-9">
        <div className="relative -mt-12 mb-6 w-fit rounded-3xl border-4 border-card bg-card">
          {avatar}
        </div>
        <div className="grid gap-7 sm:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            {name}
            <p className="text-sm text-muted-foreground">Wallpaper collector</p>
          </div>
          {handleField}
        </div>
        <div className="mt-8 border-t pt-5">{biography}</div>
      </div>
    </div>
  );
}
export function VariantC({ avatar, name, handleField, biography }: Parts) {
  return (
    <div className="divide-y rounded-xl border bg-card px-5 sm:px-7">
      <div className="grid items-center gap-5 py-6 sm:grid-cols-[130px_1fr]">
        <span className="text-sm text-muted-foreground">Profile picture</span>
        {avatar}
      </div>
      <div className="grid items-center gap-3 py-5 sm:grid-cols-[130px_1fr]">
        <span className="text-sm text-muted-foreground">Display name</span>
        {name}
      </div>
      <div className="grid gap-3 py-5 sm:grid-cols-[130px_1fr]">
        <span className="text-sm text-muted-foreground sm:pt-2">Profile handle</span>
        <div className="[&>div>label]:sr-only">{handleField}</div>
      </div>
      <div className="py-5">{biography}</div>
    </div>
  );
}

export function VariantD({ avatar, name, handleField, biography }: Parts) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="h-28 bg-gradient-to-br from-primary/20 via-primary/5 to-muted sm:h-36" />
      <div className="px-5 pb-7 sm:px-9 sm:pb-9">
        <div className="relative -mt-12 mb-6 w-fit rounded-3xl border-4 border-card bg-card">
          {avatar}
        </div>
        <div className="max-w-xl space-y-3">
          {name}
          {handleField}
        </div>
        <div className="mt-8 border-t pt-5">{biography}</div>
      </div>
    </div>
  );
}

export function VariantE({
  avatar,
  name,
  handleField,
  biography,
  aliases,
  viewProfile,
}: Parts & { viewProfile: () => void }) {
  return (
    <section
      className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      aria-label="Edit your profile"
    >
      <div className="relative h-24 bg-linear-to-r from-primary/20 via-primary/10 to-transparent sm:h-32">
        <div className="absolute top-4 right-4">
          <Button variant="outline" size="sm" className="bg-background/90" onClick={viewProfile}>
            View profile <ArrowUpRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="px-5 pb-7 sm:px-8 sm:pb-9">
        <div className="relative -mt-12 flex flex-col gap-5 sm:-mt-14 sm:flex-row sm:items-end sm:gap-7">
          {avatar}
          <div className="min-w-0 flex-1 pb-1">
            {name}
            <div className="mt-1">{handleField}</div>
          </div>
          <div className="absolute top-full left-0 mt-2 max-w-full sm:left-35">{aliases}</div>
        </div>
        <div className="mt-8 border-t pt-6">{biography}</div>
      </div>
    </section>
  );
}

function InlineProfileText({
  kind,
  appearance = 'settings',
  value,
  draft,
  onDraft,
  onSave,
  disabled = false,
  disabledHintId,
  disabledNotice,
}: {
  kind: 'name' | 'handle';
  appearance?: 'settings' | 'profile';
  value: string;
  draft: string | null;
  onDraft: (draft: string | null) => void;
  onSave: (value: string) => void;
  disabled?: boolean;
  disabledHintId?: string;
  disabledNotice?: ReactNode;
}) {
  const editing = draft !== null && !disabled;
  const label = kind === 'name' ? 'Display name' : 'Profile handle';
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const profileForm = useRef<HTMLFormElement>(null);
  const readHeight = useRef<number | undefined>(undefined);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (wasEditing.current) {
      if (disabled && disabledHintId) document.getElementById(disabledHintId)?.focus();
      else button.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing, disabled, disabledHintId]);
  const valid =
    draft !== null &&
    (kind === 'name' ? Boolean(draft.trim()) : /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft));
  if (appearance === 'profile') {
    const typography =
      kind === 'name'
        ? 'text-3xl font-bold tracking-tight text-card-foreground sm:text-4xl'
        : 'text-base font-normal text-muted-foreground sm:text-lg';
    return (
      <div className="relative flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <form
          ref={profileForm}
          className={`flex min-w-0 max-w-full items-baseline gap-1 ${typography}`}
          style={{ minHeight: editing ? readHeight.current : undefined }}
          onSubmit={(event) => {
            event.preventDefault();
            if (editing && valid && draft.trim() !== value) onSave(draft.trim());
          }}
        >
          <div className="flex min-w-0 items-baseline">
            {kind === 'handle' && <span aria-hidden="true">@</span>}
            {editing ? (
              <input
                ref={input}
                id={`prototype-inline-${kind}`}
                aria-label={label}
                className="h-[1lh] min-w-0 max-w-full rounded-sm border-0 bg-transparent p-0 text-[length:inherit] leading-[inherit] font-[inherit] tracking-[inherit] outline-none [field-sizing:content] focus-visible:ring-2 focus-visible:ring-ring/50"
                value={draft}
                maxLength={kind === 'name' ? 80 : undefined}
                autoComplete="off"
                spellCheck={kind === 'name'}
                aria-invalid={!valid}
                aria-describedby={!valid ? `prototype-inline-${kind}-error` : undefined}
                onChange={(event) => onDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    onDraft(null);
                  }
                }}
              />
            ) : kind === 'name' ? (
              <h1 className="min-w-0 break-words">{value}</h1>
            ) : (
              <p className="min-w-0 break-all">
                <span className="sr-only">@</span>
                {value}
              </p>
            )}
          </div>
          {editing ? (
            <>
              <PrototypeIconButton
                label={`Save ${label.toLowerCase()}`}
                type="submit"
                textBaseline
                buttonClassName="size-6"
                disabled={!valid || draft.trim() === value}
              >
                <Check className={kind === 'handle' ? 'size-3.5' : 'size-[1ex]'} />
              </PrototypeIconButton>
              <PrototypeIconButton
                label="Cancel"
                textBaseline
                buttonClassName="size-6"
                onClick={() => onDraft(null)}
              >
                <X className={kind === 'handle' ? 'size-3.5' : 'size-[1ex]'} />
              </PrototypeIconButton>
            </>
          ) : (
            <PrototypeIconButton
              ref={button}
              label={`Edit ${label.toLowerCase()}`}
              textBaseline
              buttonClassName="size-6"
              disabled={disabled}
              aria-describedby={disabled ? disabledHintId : undefined}
              onClick={() => {
                readHeight.current = profileForm.current?.getBoundingClientRect().height;
                onDraft(value);
              }}
            >
              <Pencil className={kind === 'handle' ? 'size-3.5' : 'size-[1ex]'} />
            </PrototypeIconButton>
          )}
        </form>
        {!editing && disabledNotice}
        {editing && !valid && (
          <p
            id={`prototype-inline-${kind}-error`}
            role="alert"
            className="w-full text-xs text-destructive"
          >
            {kind === 'name'
              ? 'Enter a display name.'
              : 'Use lowercase letters, numbers, and single hyphens.'}
          </p>
        )}
      </div>
    );
  }
  if (!editing)
    return (
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="flex min-w-0 max-w-full items-baseline gap-2">
          {kind === 'name' ? (
            <h2 className="min-w-0 break-words text-2xl font-semibold tracking-tight sm:text-3xl">
              {value}
            </h2>
          ) : (
            <p className="min-w-0 break-all text-xl font-medium text-muted-foreground sm:text-2xl">
              @{value}
            </p>
          )}
          <PrototypeIconButton
            ref={button}
            label={`Edit ${label.toLowerCase()}`}
            textBaseline
            className={kind === 'name' ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'}
            disabled={disabled}
            aria-describedby={disabled ? disabledHintId : undefined}
            onClick={() => onDraft(value)}
          >
            <Pencil className={kind === 'handle' ? 'size-3.5' : 'size-[1ex]'} />
          </PrototypeIconButton>
        </div>
        {disabledNotice}
      </div>
    );
  return (
    <form
      className="min-w-0 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && draft.trim() !== value) onSave(draft.trim());
      }}
    >
      <label htmlFor={`prototype-inline-${kind}`} className="block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        {kind === 'handle' && (
          <span className="pointer-events-none absolute top-2.5 left-3 text-sm text-muted-foreground">
            @
          </span>
        )}
        <Input
          ref={input}
          id={`prototype-inline-${kind}`}
          className={`h-10 ${kind === 'handle' ? 'pl-8' : ''}`}
          value={draft}
          maxLength={kind === 'name' ? 80 : undefined}
          autoComplete="off"
          spellCheck={kind === 'name'}
          aria-invalid={!valid}
          aria-describedby={`prototype-inline-${kind}-help`}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onDraft(null);
            }
          }}
        />
      </div>
      <p
        id={`prototype-inline-${kind}-help`}
        className={`text-xs leading-5 ${valid ? 'text-muted-foreground' : 'text-destructive'}`}
      >
        {!valid
          ? kind === 'name'
            ? 'Enter a display name.'
            : 'Use lowercase letters, numbers, and single hyphens.'
          : kind === 'name'
            ? 'The name shown beside your contributions.'
            : `You can change your handle once every seven days. @${value} will redirect to your new handle.`}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          type="submit"
          disabled={!valid || draft.trim() === value}
          aria-label={`Save ${label.toLowerCase()}`}
        >
          Save
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          aria-label={`Cancel ${label.toLowerCase()} edit`}
          onClick={() => onDraft(null)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Avatar({ value, large = false }: { value: DraftProfile; large?: boolean }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary/15 font-semibold text-primary ${large ? 'size-36 text-4xl' : 'size-24 text-3xl'}`}
    >
      {value.picture ? (
        <img className="size-full object-cover" src={value.picture} alt={value.name} />
      ) : (
        <span role="img" aria-label="Generated profile picture">
          {value.name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((word) => word[0])
            .join('')
            .toUpperCase()}
        </span>
      )}
    </div>
  );
}

function PrototypeModal({
  editor,
  close,
  opener,
  children,
}: {
  editor: Editor;
  close: () => void;
  opener: HTMLElement | null;
  children: ReactNode;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const titles = {
    picture: 'Profile picture',
    biography: 'Edit biography',
    name: 'Display name',
    aliases: 'Previous handles',
    public: 'Profile preview',
  };
  const descriptions = {
    picture: 'Choose the picture people see on your profile and contributions.',
    biography: 'Tell people a little about yourself and your collection.',
    name: 'The name people see alongside your contributions.',
    aliases: 'Previous handles help people find you after a change.',
    public: 'A preview of your profile with your local edits.',
  };
  return (
    <Dialog.Root
      open={editor !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm" />
        <Dialog.Content
          className={`fixed top-1/2 left-1/2 z-50 max-h-[88dvh] w-[calc(100%-2rem)] ${editor === 'public' ? 'max-w-5xl' : 'max-w-xl'} -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-5 shadow-2xl sm:p-7`}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            title.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener?.focus();
          }}
        >
          <Dialog.Title
            ref={title}
            tabIndex={-1}
            className="pr-9 text-lg font-semibold outline-none"
          >
            {editor && titles[editor]}
          </Dialog.Title>
          <Dialog.Description className="mt-1 mb-6 pr-6 text-sm leading-6 text-muted-foreground">
            {editor && descriptions[editor]}
          </Dialog.Description>
          <PrototypeIconButton label="Close" className="absolute top-4 right-4" onClick={close}>
            <X className="size-3.5" />
          </PrototypeIconButton>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type EditorProps = {
  value: DraftProfile;
  update: (patch: Partial<DraftProfile>, message: string) => void;
  cancel: () => void;
};
function PictureEditor({ value, update, cancel }: EditorProps) {
  const [picture, setPicture] = useState(value.picture);
  const [filename, setFilename] = useState('');
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-5">
      <div className="flex justify-center py-3">
        <Avatar value={{ ...value, picture }} large />
      </div>
      <input
        ref={input}
        id="prototype-picture-file"
        className="sr-only"
        tabIndex={-1}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Choose profile picture file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            setPicture(String(reader.result));
            setFilename(file.name);
          };
          reader.readAsDataURL(file);
        }}
      />
      <Button variant="outline" className="w-full" onClick={() => input.current?.click()}>
        <Upload className="size-4" />
        {filename ? 'Choose another picture' : 'Choose picture'}
      </Button>
      <p className="break-all text-center text-sm text-muted-foreground">
        {filename || 'JPEG, PNG or WebP · up to 5 MB'}
      </p>
      <div className="flex gap-2">
        <Button
          className="min-w-0 flex-1 px-2 text-xs sm:text-sm"
          disabled={!filename}
          onClick={() => update({ picture }, 'Profile picture updated')}
        >
          Replace picture
        </Button>
        <Button
          className="min-w-0 flex-1 px-2 text-xs sm:text-sm"
          variant="outline"
          disabled={!value.picture}
          onClick={() => update({ picture: null }, 'Profile picture removed')}
        >
          Remove picture
        </Button>
      </div>
      <Button variant="ghost" className="w-full" onClick={cancel}>
        Cancel
      </Button>
    </div>
  );
}
function BiographyEditor({
  value,
  profile,
  update,
  cancel,
  inline = false,
  compact = false,
  edit,
  onEdit,
}: EditorProps & {
  profile: Profile;
  inline?: boolean;
  compact?: boolean;
  edit?: BiographyEdit;
  onEdit?: (edit: BiographyEdit) => void;
}) {
  const [localEdit, setLocalEdit] = useState<BiographyEdit>({
    draft: value.biography,
    preview: false,
  });
  const currentEdit = edit ?? localEdit;
  const setEdit = onEdit ?? setLocalEdit;
  const { draft, preview } = currentEdit;
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (inline) textarea.current?.focus();
  }, [inline]);
  const count = [...draft].length;
  const limit = profile.biographyMaxLength ?? 5000;
  return (
    <div className="relative space-y-4">
      <fieldset
        className={
          compact
            ? 'absolute -top-8 left-0 flex h-5 gap-1'
            : 'flex gap-1 rounded-lg bg-muted/60 p-1'
        }
      >
        <legend className="sr-only">Biography editor view</legend>
        <Button
          className={compact ? 'h-5 px-2 text-xs' : 'flex-1'}
          variant={preview ? 'ghost' : 'secondary'}
          aria-pressed={!preview}
          onClick={() => setEdit({ ...currentEdit, preview: false })}
        >
          Write
        </Button>
        <Button
          className={compact ? 'h-5 px-2 text-xs' : 'flex-1'}
          variant={preview ? 'secondary' : 'ghost'}
          aria-pressed={preview}
          onClick={() => setEdit({ ...currentEdit, preview: true })}
        >
          Preview
        </Button>
      </fieldset>
      {preview ? (
        <div className={compact ? 'min-h-48' : 'min-h-48 rounded-lg border p-4'}>
          <BiographyMarkdown markdown={draft} profileId={profile.id} />
        </div>
      ) : (
        <>
          <label className="sr-only" htmlFor="prototype-biography">
            Biography
          </label>
          <Textarea
            ref={textarea}
            id="prototype-biography"
            className={
              compact
                ? 'min-h-48 resize-y rounded-sm border-0 bg-transparent p-0 text-base leading-7 shadow-none md:text-base dark:bg-transparent'
                : 'min-h-48 resize-y text-sm leading-6'
            }
            placeholder="A little about you…"
            value={draft}
            onChange={(event) => setEdit({ ...currentEdit, draft: event.target.value })}
            onKeyDown={(event) => {
              if (inline && event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancel();
              }
            }}
          />
        </>
      )}
      <p
        className={`text-right text-xs ${count > limit ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {count.toLocaleString()} / {limit.toLocaleString()} characters
      </p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Formatting help</summary>
        <p className="mt-2 leading-6">
          Use **bold**, *italic*, headings, lists, and HTTPS links. Embed your published wallpapers
          with <code className="break-all">![Description](wallpaper:wallpaper-id)</code>.
        </p>
      </details>
      {compact ? (
        <div className="absolute -top-8 right-0 flex h-5 gap-1 text-base">
          <PrototypeIconButton
            label="Save biography"
            buttonClassName="size-5"
            disabled={count > limit || draft === value.biography}
            onClick={() => update({ biography: draft }, 'Biography saved')}
          >
            <Check className="size-3.5" />
          </PrototypeIconButton>
          <PrototypeIconButton label="Cancel" buttonClassName="size-5" onClick={cancel}>
            <X className="size-3.5" />
          </PrototypeIconButton>
        </div>
      ) : (
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button
            disabled={count > limit || draft === value.biography}
            onClick={() => update({ biography: draft }, 'Biography saved')}
          >
            Save biography
          </Button>
        </div>
      )}
    </div>
  );
}
function NameEditor({ value, update, cancel }: EditorProps) {
  const [draft, setDraft] = useState(value.name);
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        update({ name: draft.trim() }, 'Display name updated');
      }}
    >
      <label htmlFor="prototype-name" className="block space-y-2 text-sm font-medium">
        <span>Display name</span>
        <Input
          id="prototype-name"
          value={draft}
          maxLength={80}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!draft.trim() || draft === value.name}>
          Save name
        </Button>
      </div>
    </form>
  );
}
function AliasesEditor({
  value,
  onChange,
}: {
  value: DraftProfile;
  onChange: (aliases: PreviousHandle[]) => void;
}) {
  const [feedback, setFeedback] = useState('');
  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-muted/60 px-4 py-3 text-sm">
        Current profile handle <strong className="mt-1 block break-all">@{value.handle}</strong>
      </div>
      {(['retained', 'expiring', 'historical'] as const).map((status) => {
        const items = value.aliases.filter((alias) => alias.status === status);
        return (
          <section key={status} className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {status === 'historical'
                  ? 'Recently used'
                  : status === 'expiring'
                    ? 'Expiring'
                    : 'Retained'}
              </h3>
              <span className="text-xs text-muted-foreground">
                {items.length}
                {status === 'retained' ? ` of ${value.retainedLimit}` : ''}
              </span>
            </div>
            {items.length ? (
              <ul className="space-y-2">
                {items.map((alias) => (
                  <li key={alias.handle} className="rounded-xl border bg-background/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="break-all text-sm font-semibold">@{alias.handle}</span>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] ${status === 'expiring' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}
                      >
                        {status === 'retained'
                          ? 'Redirect active'
                          : status === 'expiring'
                            ? 'Removal scheduled'
                            : alias.unavailableReason
                              ? 'Unavailable'
                              : 'Available to restore'}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {status === 'retained'
                        ? `Redirects to @${value.handle}.`
                        : status === 'expiring'
                          ? alias.expiresAt
                            ? `Redirect ends ${new Date(alias.expiresAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`
                            : 'Redirect stays active until the removal takes effect.'
                          : alias.eligibleUntil
                            ? `Can be restored until ${new Date(alias.eligibleUntil).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`
                            : 'Restore this handle to redirect people to your profile.'}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      disabled={
                        status === 'historical' &&
                        (Boolean(alias.unavailableReason) ||
                          value.aliases.filter((item) => item.status === 'retained').length >=
                            value.retainedLimit)
                      }
                      onClick={() => {
                        const nextStatus =
                          status === 'retained'
                            ? 'expiring'
                            : status === 'expiring'
                              ? 'historical'
                              : 'retained';
                        onChange(
                          value.aliases.map((item) =>
                            item.handle === alias.handle
                              ? {
                                  ...item,
                                  status: nextStatus,
                                  expiresAt:
                                    nextStatus === 'expiring'
                                      ? new Date(Date.now() + 86400000).toISOString()
                                      : null,
                                }
                              : item
                          )
                        );
                        setFeedback(
                          status === 'retained'
                            ? `Removal scheduled for @${alias.handle}. It will redirect for another 24 hours.`
                            : status === 'expiring'
                              ? `@${alias.handle} no longer redirects to your profile.`
                              : `@${alias.handle} now redirects to your profile.`
                        );
                      }}
                    >
                      {status === 'retained' ? (
                        <>
                          <Clock3 className="size-3.5" />
                          Schedule removal
                        </>
                      ) : status === 'expiring' ? (
                        'Remove now'
                      ) : (
                        'Restore redirect'
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
                {status === 'historical'
                  ? 'No recently used handles to restore.'
                  : `No ${status} handles.`}
              </p>
            )}
          </section>
        );
      })}
      <output className="block text-sm text-muted-foreground">{feedback}</output>
    </div>
  );
}
