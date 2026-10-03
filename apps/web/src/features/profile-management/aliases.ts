import type { AliasCommand } from './contract';
export function aliasChangeDialog(command: AliasCommand | null, currentHandle: string) {
  const handle = command?.handle ?? '';
  switch (command?.action) {
    case 'keep':
      return {
        title: 'Keep this alias?',
        description: `Cancel the scheduled removal of @${handle}. It will keep redirecting and use one retained alias slot. Your current Handle will stay @${currentHandle}, and its change cooldown will stay the same.`,
        button: 'Keep alias',
      };
    case 'reactivate':
      return {
        title: 'Reactivate historical Handle?',
        description: `@${handle} will redirect to your Profile and use one retained alias slot. Your current Handle will stay @${currentHandle}, and its change cooldown will stay the same.`,
        button: 'Reactivate alias',
      };
    case 'expire':
      return {
        title: 'Expire alias now?',
        description: `@${handle} will stop redirecting immediately. This Handle will become available for another User to claim. Existing links using this handle will no longer lead to your Profile.`,
        button: 'Expire now',
      };
    default:
      return {
        title: 'Schedule alias removal?',
        description: `@${handle} will expire 24 hours after you confirm. This profile handle will redirect until it expires, then stop redirecting to your Profile. It stops counting toward your retained limit immediately.`,
        button: 'Schedule removal',
      };
  }
}

export function classifyAliases<
  Alias extends { handle: string; expiresAt?: string | null },
  History extends { handle: string },
>(profile: { aliases?: Alias[]; historicalHandles?: History[] }) {
  const retained = (profile.aliases ?? []).filter((alias) => !alias.expiresAt);
  const expiring = (profile.aliases ?? []).filter((alias) => alias.expiresAt);
  const historical = (profile.historicalHandles ?? []).filter(
    (entry) => !profile.aliases?.some((alias) => alias.handle === entry.handle)
  );
  const summary =
    retained.length || expiring.length
      ? `${retained.length} retained${expiring.length ? ` · ${expiring.length} expiring` : ''}`
      : historical.length
        ? `${historical.length} historical`
        : 'No previous handles';
  return { retained, expiring, historical, summary };
}
export function historicalHandleAvailability(
  eligibleUntil: number,
  reason: 'claimed' | 'alias-limit' | null,
  now: number
): string | null {
  if (eligibleUntil <= now)
    return 'This Handle is no longer in your recent history. Refresh aliases.';
  if (reason === 'claimed') return 'Another Profile has claimed this Handle.';
  if (reason === 'alias-limit') return 'Your retained-alias limit is full.';
  return null;
}
export function aliasConflictMessage(action: AliasCommand['action']): string {
  const verbs = {
    schedule: 'scheduling',
    expire: 'expiring',
    reactivate: 'reactivating',
    keep: 'canceling removal',
  };
  return `Your Profile changed elsewhere. Refresh aliases before ${verbs[action]} again.`;
}
