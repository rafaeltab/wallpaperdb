// THROWAWAY: three minimal Profile settings layouts on /settings/profile?variant=A|B|C.
// All edits stay in React state. Delete after the design decision; do not promote as-is.
import type { Profile } from '@/lib/api/user';

export default function ProfileSettingsPrototype({ profile, variant }: { profile: Profile; variant: 'A' | 'B' | 'C' }) {
  return <div className="mx-auto max-w-3xl p-8"><h1 className="text-2xl font-semibold">Your profile</h1><p>{profile.displayName} · Prototype {variant}</p></div>;
}
