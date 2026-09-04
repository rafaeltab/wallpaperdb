import { getAuthToken } from '@/lib/auth/token-provider';

export interface Profile {
  id: string;
  handle: string;
  displayName: string;
  biographyMarkdown: string;
  pictureAssetId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export class UserApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'UserApiError';
    this.status = status;
  }
}

interface UserApiClientOptions {
  baseUrl: string;
  tokenProvider: () => Promise<string | null>;
}

interface EnsureProfileOptions {
  signal?: AbortSignal;
  expectedProfileId?: string;
  tokenProvider?: () => Promise<string | null>;
}

interface UpdateProfileOptions {
  displayName: string;
  expectedVersion: number;
  expectedProfileId?: string;
  tokenProvider?: () => Promise<string | null>;
}

export function createUserApiClient({ baseUrl, tokenProvider }: UserApiClientOptions) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  return {
    async ensureProfile(options: EnsureProfileOptions = {}): Promise<Profile> {
      const token = await (options.tokenProvider ?? tokenProvider)();
      if (!token) throw new UserApiError('Authentication token is not ready', 401);

      const response = await fetch(`${normalizedBaseUrl}/profile/me/ensure`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: options.signal,
      });

      if (!response.ok) {
        throw await userApiError(response);
      }

      const profile: unknown = await response.json();
      if (!isProfile(profile)) {
        throw new UserApiError('User API returned a malformed Profile', 502);
      }
      if (options.expectedProfileId && profile.id !== options.expectedProfileId) {
        throw new UserApiError('User API returned a Profile for another User', 502);
      }
      return profile;
    },

    async updateProfile(options: UpdateProfileOptions): Promise<Profile> {
      const token = await (options.tokenProvider ?? tokenProvider)();
      if (!token) throw new UserApiError('Authentication token is not ready', 401);

      const response = await fetch(`${normalizedBaseUrl}/profile/me`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: options.displayName,
          expectedVersion: options.expectedVersion,
        }),
      });

      if (!response.ok) {
        throw await userApiError(response);
      }

      const profile: unknown = await response.json();
      if (!isProfile(profile)) {
        throw new UserApiError('User API returned a malformed Profile', 502);
      }
      if (options.expectedProfileId && profile.id !== options.expectedProfileId) {
        throw new UserApiError('User API returned a Profile for another User', 502);
      }
      return profile;
    },
  };
}

async function userApiError(response: Response): Promise<UserApiError> {
  let message = `User API request failed with status ${response.status}`;
  try {
    const body = (await response.json()) as { detail?: unknown; message?: unknown };
    if (typeof body.detail === 'string') message = body.detail;
    else if (typeof body.message === 'string') message = body.message;
  } catch {
    // Preserve the status-based message for non-JSON responses.
  }
  return new UserApiError(message, response.status);
}

function isProfile(value: unknown): value is Profile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.id === 'string' &&
    typeof profile.handle === 'string' &&
    typeof profile.displayName === 'string' &&
    typeof profile.biographyMarkdown === 'string' &&
    (profile.pictureAssetId === null || typeof profile.pictureAssetId === 'string') &&
    Number.isInteger(profile.version) &&
    typeof profile.createdAt === 'string' &&
    typeof profile.updatedAt === 'string'
  );
}

export const userApi = createUserApiClient({
  baseUrl: import.meta.env.VITE_USER_URL || '/user',
  tokenProvider: getAuthToken,
});
