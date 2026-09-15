import { useIsFetching, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { countProfileMarkdownCharacters, validateProfileMarkdown } from '@wallpaperdb/profile-markdown';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { BiographyMarkdown } from './profile-biography';
import { Textarea } from '@/components/ui/textarea';
import { ProfileActionButton } from './profile-action-button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { type Profile, userApi, UserApiError } from '@/lib/api/user';
import { positiveIntegerEnv } from '@/lib/runtime-config';
import './profile-edit-feedback.css';

const DISPLAY_NAME_MAX_LENGTH = positiveIntegerEnv(import.meta.env.VITE_PROFILE_DISPLAY_NAME_MAX_LENGTH, 80);

type Field = 'displayName' | 'handle' | 'biographyMarkdown';
type Props = { field: Field; profile: Profile; tokenProvider: () => Promise<string | null> };
type Edit = { value: string; baseValue: string; baseVersion: number; baseProfile: Profile };
type Phase = 'idle' | 'saving' | 'success' | 'error';
const labels = { displayName: 'display name', handle: 'profile handle', biographyMarkdown: 'biography' };

export function ProfileInlineField(props: Props) {
  return <InlineField key={`${props.profile.id}:${props.field}`} {...props} />;
}

function InlineField({ field, profile, tokenProvider }: Props) {
  const queryClient = useQueryClient();
  const key = profileQueryKey(profile.id);
  const refreshing = useIsFetching({ queryKey: key }) > 0;
  const writing = useIsMutating({ mutationKey: key }) > 0;
  const [preview, setPreview] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmation, setConfirmation] = useState<{ command: Edit; aliases: string[] } | null>(null);
  const [serverDeadline, setServerDeadline] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const deadline = serverDeadline ? Date.parse(serverDeadline) : profile.lastHandleChangedAt ? Date.parse(profile.lastHandleChangedAt) + 7 * 24 * 60 * 60 * 1000 : Number.NaN;
  const coolingDown = field === 'handle' && deadline > now;
  useEffect(() => {
    if (!coolingDown) return;
    const tick = setTimeout(() => setNow(Date.now()), Math.min(deadline - now, 60_000));
    return () => clearTimeout(tick);
  }, [coolingDown, deadline, now]);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const live = useRef(true);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const label = labels[field];
  const title = label[0].toUpperCase() + label.slice(1);
  const mutation = useMutation({
    mutationKey: key,
    mutationFn: (command: Edit) => {
      const options = { expectedVersion: command.baseVersion, expectedProfileId: profile.id, tokenProvider };
      return field === 'handle' ? userApi.updateHandle({ ...options, handle: command.value }) : userApi.updateProfile({ ...options, [field]: command.value });
    },
  });
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; clearTimeout(timer.current); };
  }, []);
  const editing = edit !== null;
  useEffect(() => { if (editing) (field === 'biographyMarkdown' ? textarea.current : input.current)?.focus(); }, [editing, field, preview]);
  useEffect(() => {
    setEdit((current) => current && current.value === current.baseValue ? { value: profile[field], baseValue: profile[field], baseVersion: profile.version, baseProfile: profile } : current);
  }, [field, profile[field], profile.version]);
  async function refresh() {
    if (pending.current || queryClient.isFetching({ queryKey: key }) || queryClient.isMutating({ mutationKey: key })) return;
    try {
      await queryClient.refetchQueries({ queryKey: key, exact: true }, { throwOnError: true });
      if (!live.current) return;
      const updated = queryClient.getQueryData<Profile>(key);
      if (!updated) throw new Error('Profile unavailable');
      setEdit((current) => current ? { value: current.value === current.baseValue ? updated[field] : current.value, baseValue: updated[field], baseVersion: updated.version, baseProfile: updated } : null);
      setConflict(false);
      setError(null);
      clearTimeout(timer.current);
      setPhase('idle');
    } catch {
      if (!live.current) return;
      setError('Unable to refresh profile. Try again.');
      toast.error('Unable to refresh profile');
    }
  }
  function finish() {
    const restore = container.current?.contains(document.activeElement);
    setEdit(null);
    setPhase('idle');
    setError(null);
    setConflict(false);
    clearTimeout(timer.current);
    queueMicrotask(() => { if (live.current && restore) opener.current?.focus(); });
  }
  async function save(command = edit, confirmed = false) {
    if (!command || fieldError(field, command.value, profile.biographyMaxLength ?? 5000) || pending.current || coolingDown || phase !== 'idle' || queryClient.isFetching({ queryKey: key }) || queryClient.isMutating({ mutationKey: key })) return;
    const aliases = field === 'handle' ? aliasesToSchedule(command.baseProfile, command.value) : [];
    if (!confirmed && aliases.length) { setConfirmation({ command, aliases }); return; }
    setConfirmation(null);
    pending.current = true;
    setPhase('saving');
    setError(null);
    try {
      const updated = await mutation.mutateAsync(command);
      // Navigation may unmount this editor; keep an existing owner cache current.
      // Logout removes the query, which must never be recreated by a late response.
      if (queryClient.getQueryState(key)) queryClient.setQueryData(key, updated);
      if (!live.current) return;
      setEdit({ value: updated[field], baseValue: updated[field], baseVersion: updated.version, baseProfile: updated });
      setPhase('success');
      if (field === 'handle') { setServerDeadline(null); setNow(Date.now()); }
      toast.success(field === 'handle' && updated.handle === command.baseValue ? 'Profile handle unchanged' : `${title} updated`);
      timer.current = setTimeout(() => { pending.current = false; finish(); }, 1600);
    } catch (cause) {
      if (!live.current) return;
      pending.current = false;
      if (cause instanceof UserApiError && cause.nextHandleChangeAt) { setServerDeadline(cause.nextHandleChangeAt); setNow(Date.now()); }
      const message = cause instanceof Error ? cause.message : `Unable to save ${label}.`;
      const versionConflict = cause instanceof UserApiError && Boolean(cause.type?.endsWith('/profile-version-conflict'));
      setConflict(versionConflict);
      setError(versionConflict ? 'Your profile changed elsewhere. Refresh profile to keep your draft and try again.' : message);
      setPhase('error');
      toast.error(`Unable to save ${label}`, { description: message });
      timer.current = setTimeout(() => setPhase('idle'), 1600);
    }
  }
  const maxCharacters = profile.biographyMaxLength ?? 5000;
  const validationError = edit ? fieldError(field, edit.value, maxCharacters) : undefined;
  const locked = phase === 'saving' || phase === 'success';
  const actionLabel = phase === 'saving' ? `Saving ${label}` : phase === 'success' ? `${title} saved` : phase === 'error' ? `${title} save failed` : `Save ${label}`;
  const typography = field === 'displayName' ? 'text-3xl font-bold tracking-tight text-card-foreground sm:text-4xl' : 'text-base font-normal text-muted-foreground sm:text-lg';
  const iconSize = field === 'displayName' ? 'size-[1ex]' : 'size-3.5';
  const actions = <><ProfileActionButton label={actionLabel} type="submit" textBaseline={field !== 'biographyMarkdown'} buttonClassName="size-6" disabled={Boolean(validationError) || phase !== 'idle' || coolingDown || refreshing || writing || !edit || edit.value === edit.baseValue}>
          {phase === 'saving' ? <Loader2 className={`${iconSize} animate-spin motion-reduce:animate-none`} /> : phase === 'error' ? <X className={`profile-save-feedback ${iconSize}`} data-save-phase={phase} /> : <Check className={`profile-save-feedback ${iconSize}`} data-save-phase={phase} />}
        </ProfileActionButton>
        <ProfileActionButton label="Cancel" textBaseline={field !== 'biographyMarkdown'} buttonClassName="size-6" disabled={locked} onClick={finish}><X className={iconSize} /></ProfileActionButton></>;
  const errorNotice = <>{(error || validationError) && <div role="alert" className="mt-2 text-sm text-destructive">{error ?? validationError}{conflict && <Button type="button" variant="outline" size="sm" className="ml-2" disabled={refreshing || writing || locked} onClick={() => void refresh()}>Refresh profile</Button>}</div>}</>;
  if (field === 'biographyMarkdown') return <div ref={container} className="min-w-0 w-full">
    <section aria-label="Biography" className="w-full min-w-0">
      {edit ? <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="w-full space-y-3">
        <div className="flex min-h-5 items-center justify-between gap-3">
          <div className="flex gap-2" aria-label="Biography editor mode">
            <Button type="button" variant={preview ? 'ghost' : 'secondary'} size="sm" aria-pressed={!preview} disabled={locked} onClick={() => setPreview(false)}>Write</Button>
            <Button type="button" variant={preview ? 'secondary' : 'ghost'} size="sm" aria-pressed={preview} disabled={locked} onClick={() => setPreview(true)}>Preview</Button>
          </div>
          <div className="flex gap-1">{actions}</div>
        </div>
        {preview ? <section aria-label="Biography preview" className="min-h-48 w-full rounded-md border p-3">
          <BiographyMarkdown markdown={edit.value} profileId={profile.id} maxCharacters={maxCharacters} refreshKey={previewRevision} />
          <Button type="button" variant="ghost" size="sm" className="mt-3" disabled={locked} onClick={() => setPreviewRevision((revision) => revision + 1)}>Refresh preview</Button>
        </section> : <Textarea ref={textarea} aria-label="Biography Markdown" value={edit.value} rows={7} className="min-h-48 w-full font-mono text-sm" disabled={locked || refreshing || writing} aria-invalid={Boolean(validationError)} onChange={(event) => setEdit({ ...edit, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape' && !locked) finish(); }} />}
        <p className="text-right text-xs text-muted-foreground">{countProfileMarkdownCharacters(edit.value)} / {maxCharacters} characters</p>
        {errorNotice}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Formatting help</summary><p className="mt-2 leading-relaxed">Use headings, lists, emphasis, tables, and HTTPS links. Embed a published wallpaper you own with <code className="break-all">![Alt text](wallpaper:wallpaper-id)</code>. New uploads may take a moment to become available.</p></details>
      </form> : <>
        <div className="relative h-5"><h2 className="sr-only">Biography</h2><Button ref={opener} type="button" variant="outline" size="sm" className="absolute -top-1.5 right-0" disabled={refreshing || writing} onClick={() => { setPreview(false); setEdit({ value: profile[field], baseValue: profile[field], baseVersion: profile.version, baseProfile: profile }); }}><Pencil className="size-3.5" />Edit biography</Button></div>
        <div className="mt-3"><BiographyMarkdown markdown={profile.biographyMarkdown} profileId={profile.id} maxCharacters={maxCharacters} refreshKey={profile.version} /></div>
      </>}
    </section>
  </div>;
  return <div ref={container} className="min-w-0">
    <form className={`flex min-w-0 max-w-full items-baseline gap-1 ${typography}`} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {field === 'handle' && <span aria-hidden="true">@</span>}
      {edit ? <>
        <input ref={input} aria-label={title} className="h-[1lh] min-w-0 max-w-full [field-sizing:content] rounded border-0 bg-transparent p-0 text-[length:inherit] leading-[inherit] tracking-[inherit] outline-none [font-weight:inherit] focus-visible:ring-2 focus-visible:ring-ring" value={edit.value} disabled={locked} onChange={(event) => setEdit({ ...edit, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape' && !locked) finish(); }} />
        {actions}
      </> : <>
        {field === 'displayName' ? <h1 className="min-w-0 break-words">{profile[field]}</h1> : <p className="min-w-0 break-words"><span className="sr-only">@</span>{profile[field]}</p>}
        <ProfileActionButton ref={opener} label={`Edit ${label}`} textBaseline buttonClassName="size-6" disabled={coolingDown || refreshing || writing} onClick={() => setEdit({ value: profile[field], baseValue: profile[field], baseVersion: profile.version, baseProfile: profile })}><Pencil className={iconSize} /></ProfileActionButton>
      </>}
    </form>
    {coolingDown && <p className="mt-1 text-xs text-muted-foreground">Available for change in <Tooltip><TooltipTrigger asChild><button type="button" className="underline decoration-dotted underline-offset-4"><time dateTime={new Date(deadline).toISOString()}>{relativeDeadline(deadline - now)}</time></button></TooltipTrigger><TooltipContent>{new Date(deadline).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}</TooltipContent></Tooltip></p>}
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open) setConfirmation(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Change profile handle and schedule alias removal?</AlertDialogTitle><AlertDialogDescription>Your retained-alias limit is {confirmation?.command.baseProfile.retainedAliasLimit ?? 3}. Changing your profile handle will schedule {confirmation?.aliases.map((alias) => `@${alias}`).join(', ')} for removal. These handles will redirect for 24 hours after confirmation, then expire and stop redirecting to your profile.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={refreshing || writing || coolingDown} onClick={() => { if (confirmation) void save(confirmation.command, true); }}>Confirm handle change</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {errorNotice}
  </div>;
}

function relativeDeadline(milliseconds: number) {
  const days = Math.ceil(milliseconds / 86_400_000);
  if (days > 1) return `${days} days`;
  const hours = Math.ceil(milliseconds / 3_600_000);
  if (hours > 1) return `${hours} hours`;
  const minutes = Math.ceil(milliseconds / 60_000);
  return minutes > 1 ? `${minutes} minutes` : 'less than a minute';
}

function aliasesToSchedule(profile: Profile, requestedHandle: string): string[] {
  const normalized = requestedHandle.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (normalized === profile.handle) return [];
  const retained = (profile.aliases ?? []).filter((alias) => !alias.expiresAt && alias.handle !== normalized);
  const candidates = [...retained.map((alias) => alias.handle), profile.handle];
  return candidates.slice(0, Math.max(0, candidates.length - (profile.retainedAliasLimit ?? 3)));
}

function fieldError(field: Field, value: string, maxCharacters: number): string | undefined {
  if (field === 'biographyMarkdown') {
    const result = validateProfileMarkdown(value, { maxCharacters });
    return result.valid ? undefined : result.errors[0]?.message;
  }
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized) return `${field === 'displayName' ? 'Display name' : 'Profile handle'} must not be blank.`;
  if (field === 'displayName' && [...normalized].length > DISPLAY_NAME_MAX_LENGTH) return `Display name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`;
  return undefined;
}
