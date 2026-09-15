import { useIsFetching, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { ProfileActionButton } from './profile-action-button';
import { type Profile, userApi } from '@/lib/api/user';
import './profile-edit-feedback.css';

type Field = 'displayName' | 'handle' | 'biographyMarkdown';
type Props = { field: Field; profile: Profile; tokenProvider: () => Promise<string | null> };
type Edit = { value: string; baseValue: string; baseVersion: number };
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
  const [edit, setEdit] = useState<Edit | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const live = useRef(true);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const label = labels[field];
  const title = label[0].toUpperCase() + label.slice(1);
  const mutation = useMutation({
    mutationKey: key,
    mutationFn: (command: Edit) => userApi.updateProfile({ [field]: command.value, expectedVersion: command.baseVersion, expectedProfileId: profile.id, tokenProvider }),
  });
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; clearTimeout(timer.current); };
  }, []);
  useEffect(() => { if (edit) input.current?.focus(); }, [Boolean(edit)]);
  function finish() {
    const restore = container.current?.contains(document.activeElement);
    setEdit(null);
    setPhase('idle');
    setError(null);
    clearTimeout(timer.current);
    queueMicrotask(() => { if (live.current && restore) opener.current?.focus(); });
  }
  async function save() {
    if (!edit || pending.current || phase !== 'idle' || queryClient.isFetching({ queryKey: key }) || queryClient.isMutating({ mutationKey: key })) return;
    pending.current = true;
    setPhase('saving');
    setError(null);
    try {
      const updated = await mutation.mutateAsync(edit);
      if (!live.current) return;
      queryClient.setQueryData(key, updated);
      setEdit({ value: updated[field], baseValue: updated[field], baseVersion: updated.version });
      setPhase('success');
      toast.success(`${title} updated`);
      timer.current = setTimeout(() => { pending.current = false; finish(); }, 1600);
    } catch (cause) {
      if (!live.current) return;
      pending.current = false;
      const message = cause instanceof Error ? cause.message : `Unable to save ${label}.`;
      setError(message);
      setPhase('error');
      toast.error(`Unable to save ${label}`, { description: message });
      timer.current = setTimeout(() => setPhase('idle'), 1600);
    }
  }
  const locked = phase === 'saving' || phase === 'success';
  const actionLabel = phase === 'saving' ? `Saving ${label}` : phase === 'success' ? `${title} saved` : phase === 'error' ? `${title} save failed` : `Save ${label}`;
  const typography = field === 'displayName' ? 'text-3xl font-bold tracking-tight text-card-foreground sm:text-4xl' : 'text-base font-normal text-muted-foreground sm:text-lg';
  return <div ref={container} className="min-w-0">
    <form className={`flex min-w-0 max-w-full items-baseline gap-1 ${typography}`} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {edit ? <>
        <input ref={input} aria-label={title} className="h-[1lh] min-w-0 max-w-full [field-sizing:content] rounded border-0 bg-transparent p-0 text-[length:inherit] leading-[inherit] tracking-[inherit] outline-none [font-weight:inherit] focus-visible:ring-2 focus-visible:ring-ring" value={edit.value} disabled={locked} onChange={(event) => setEdit({ ...edit, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape' && !locked) finish(); }} />
        <ProfileActionButton label={actionLabel} type="submit" textBaseline buttonClassName="size-6" disabled={phase !== 'idle' || refreshing || writing || edit.value === edit.baseValue}>
          {phase === 'saving' ? <Loader2 className="size-[1ex] animate-spin motion-reduce:animate-none" /> : phase === 'error' ? <X className="profile-save-feedback size-[1ex]" data-save-phase={phase} /> : <Check className="profile-save-feedback size-[1ex]" data-save-phase={phase} />}
        </ProfileActionButton>
        <ProfileActionButton label="Cancel" textBaseline buttonClassName="size-6" disabled={locked} onClick={finish}><X className="size-[1ex]" /></ProfileActionButton>
      </> : <>
        <h1 className="min-w-0 break-words">{profile[field]}</h1>
        <ProfileActionButton ref={opener} label={`Edit ${label}`} textBaseline buttonClassName="size-6" onClick={() => setEdit({ value: profile[field], baseValue: profile[field], baseVersion: profile.version })}><Pencil className="size-[1ex]" /></ProfileActionButton>
      </>}
    </form>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </div>;
}
