import { createHash, randomBytes } from 'node:crypto';

export interface ExternalIdentity {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

const adjectives = ['Brisk', 'Curious', 'Daring', 'Gentle', 'Luminous', 'Ostentatious'];
const nouns = ['Badger', 'Kestrel', 'Picklejar', 'Seashell', 'Starling', 'Willow'];

function cleanPart(value?: string | null): string {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

export type FallbackNameSelector = (profileId: string) => string;

export function selectFallbackName(profileId: string): string {
  const digest = createHash('sha256').update(profileId).digest();
  return `${adjectives[digest[0] % adjectives.length]} ${nouns[digest[1] % nouns.length]}`;
}

export function deriveDisplayName(
  profileId: string,
  identity: ExternalIdentity,
  fallbackName: FallbackNameSelector = selectFallbackName
): string {
  const displayName = cleanPart(identity.displayName);
  if (displayName) return displayName;

  const fullName = [cleanPart(identity.firstName), cleanPart(identity.lastName)]
    .filter(Boolean)
    .join(' ');
  if (fullName) return fullName;

  return cleanPart(fallbackName(profileId));
}

export function slugifyHandle(value: string, minLength: number, maxLength: number): string {
  const handle = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  if (handle.length < minLength) throw new Error('Display name cannot produce a valid handle');
  return handle;
}

interface CandidateOptions {
  minLength: number;
  maxLength: number;
  reserved: ReadonlySet<string>;
  attempts: number;
  nextSuffix?: () => string;
}

export function* handleCandidates(
  displayName: string,
  options: CandidateOptions
): Generator<string> {
  const base = slugifyHandle(displayName, options.minLength, options.maxLength);
  if (!options.reserved.has(base)) yield base;

  const nextSuffix = options.nextSuffix ?? (() => randomBytes(3).toString('hex'));
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    const suffix = slugifyHandle(nextSuffix(), 1, options.maxLength);
    const prefix = base
      .slice(0, Math.max(0, options.maxLength - suffix.length - 1))
      .replace(/-+$/g, '');
    const candidate = prefix ? `${prefix}-${suffix}` : suffix.slice(0, options.maxLength);
    if (candidate.length >= options.minLength && !options.reserved.has(candidate)) yield candidate;
  }
}
