import { getAuthToken } from '@/lib/auth/token-provider';

export interface ProfileAlias {
  handle: string;
  claimGeneration: number;
  createdAt?: string;
  expiresAt?: string | null;
}

export interface HistoricalHandle {
  handle: string;
  eligibleUntil: string;
  unavailableReason: 'claimed' | 'alias-limit' | null;
}

export interface Profile {
  id: string;
  handle: string;
  displayName: string;
  biographyMarkdown: string;
  biographyMaxLength?: number;
  pictureAssetId: string | null;
  pictureImportStatus?: 'pending' | 'retrying' | 'complete';
  pictureUploadLimits?: { maxBytes: number; maxPixels: number; maxDecodedBytes: number };
  version: number;
  createdAt: string;
  updatedAt: string;
  lastHandleChangedAt?: string | null;
  aliases?: ProfileAlias[];
  retainedAliasLimit?: number;
  historicalHandles?: HistoricalHandle[];
}

export class UserApiError extends Error {
  readonly status: number;
  readonly type?: string;
  readonly nextHandleChangeAt?: string;

  constructor(
    message: string,
    status: number,
    details: { type?: string; nextHandleChangeAt?: string } = {}
  ) {
    super(message);
    this.name = 'UserApiError';
    this.status = status;
    this.type = details.type;
    this.nextHandleChangeAt = details.nextHandleChangeAt;
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
  displayName?: string;
  biographyMarkdown?: string;
  expectedVersion: number;
  expectedProfileId?: string;
  tokenProvider?: () => Promise<string | null>;
}

interface UpdateHandleOptions {
  handle: string;
  expectedVersion: number;
  expectedProfileId?: string;
  tokenProvider?: () => Promise<string | null>;
}

interface AliasCommandOptions {
  handle: string;
  expectedVersion: number;
  expectedProfileId?: string;
  tokenProvider?: () => Promise<string | null>;
}

interface PictureCommandOptions {
  expectedVersion: number;
  expectedProfileId?: string;
  tokenProvider?: () => Promise<string | null>;
}

interface UploadPictureOptions extends PictureCommandOptions {
  picture: File;
}

export function createUserApiClient({ baseUrl, tokenProvider }: UserApiClientOptions) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  return {
    async uploadPicture(options: UploadPictureOptions): Promise<Profile> {
      const token = await (options.tokenProvider ?? tokenProvider)();
      if (!token) throw new UserApiError('Authentication token is not ready', 401);
      const form = new FormData();
      form.set('picture', options.picture);
      form.set('expectedVersion', String(options.expectedVersion));

      const response = await fetch(`${normalizedBaseUrl}/profile/me/picture`, {
        method: 'PUT',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!response.ok) throw await userApiError(response);
      const profile: unknown = await response.json();
      if (!isProfile(profile)) throw new UserApiError('User API returned a malformed Profile', 502);
      if (options.expectedProfileId && profile.id !== options.expectedProfileId) {
        throw new UserApiError('User API returned a Profile for another User', 502);
      }
      return profile;
    },

    async removePicture(options: PictureCommandOptions): Promise<Profile> {
      const token = await (options.tokenProvider ?? tokenProvider)();
      if (!token) throw new UserApiError('Authentication token is not ready', 401);
      const response = await fetch(`${normalizedBaseUrl}/profile/me/picture`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expectedVersion: options.expectedVersion }),
      });
      if (!response.ok) throw await userApiError(response);
      const profile: unknown = await response.json();
      if (!isProfile(profile)) throw new UserApiError('User API returned a malformed Profile', 502);
      if (options.expectedProfileId && profile.id !== options.expectedProfileId) {
        throw new UserApiError('User API returned a Profile for another User', 502);
      }
      return profile;
    },

    async reactivateAlias(options: AliasCommandOptions): Promise<Profile> {
      const token = await (options.tokenProvider ?? tokenProvider)();
      if (!token) throw new UserApiError('Authentication token is not ready', 401);

      const response = await fetch(
        `${normalizedBaseUrl}/profile/me/aliases/${encodeURIComponent(options.handle)}`,
        {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expectedVersion: options.expectedVersion }),
        }
      );
      if (!response.ok) throw await userApiError(response);

      const profile: unknown = await response.json();
      if (!isProfile(profile)) {
        throw new UserApiError('User API returned a malformed Profile', 502);
      }
      if (options.expectedProfileId && profile.id !== options.expectedProfileId) {
        throw new UserApiError('User API returned a Profile for another User', 502);
      }
      return profile;
    },

    async expireAlias(options: AliasCommandOptions): Promise<Profile> {
      const token = await (options.tokenProvider ?? tokenProvider)();
      if (!token) throw new UserApiError('Authentication token is not ready', 401);

      const response = await fetch(
        `${normalizedBaseUrl}/profile/me/aliases/${encodeURIComponent(options.handle)}/expire`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expectedVersion: options.expectedVersion }),
        }
      );
      if (!response.ok) throw await userApiError(response);

      const profile: unknown = await response.json();
      if (!isProfile(profile)) {
        throw new UserApiError('User API returned a malformed Profile', 502);
      }
      if (options.expectedProfileId && profile.id !== options.expectedProfileId) {
        throw new UserApiError('User API returned a Profile for another User', 502);
      }
      return profile;
    },

    async scheduleAliasRemoval(options: AliasCommandOptions): Promise<Profile> {
      const token = await (options.tokenProvider ?? tokenProvider)();
      if (!token) throw new UserApiError('Authentication token is not ready', 401);

      const response = await fetch(
        `${normalizedBaseUrl}/profile/me/aliases/${encodeURIComponent(options.handle)}`,
        {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expectedVersion: options.expectedVersion }),
        }
      );
      if (!response.ok) throw await userApiError(response);

      const profile: unknown = await response.json();
      if (!isProfile(profile)) {
        throw new UserApiError('User API returned a malformed Profile', 502);
      }
      if (options.expectedProfileId && profile.id !== options.expectedProfileId) {
        throw new UserApiError('User API returned a Profile for another User', 502);
      }
      return profile;
    },

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

    async updateHandle(options: UpdateHandleOptions): Promise<Profile> {
      const token = await (options.tokenProvider ?? tokenProvider)();
      if (!token) throw new UserApiError('Authentication token is not ready', 401);

      const response = await fetch(`${normalizedBaseUrl}/profile/me/handle`, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ handle: options.handle, expectedVersion: options.expectedVersion }),
      });
      if (!response.ok) throw await userApiError(response);

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
          biographyMarkdown: options.biographyMarkdown,
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
  const details: { type?: string; nextHandleChangeAt?: string } = {};
  try {
    const body = (await response.json()) as {
      detail?: unknown;
      message?: unknown;
      type?: unknown;
      nextHandleChangeAt?: unknown;
    };
    if (typeof body.detail === 'string') message = body.detail;
    else if (typeof body.message === 'string') message = body.message;
    if (typeof body.type === 'string') details.type = body.type;
    if (typeof body.nextHandleChangeAt === 'string')
      details.nextHandleChangeAt = body.nextHandleChangeAt;
  } catch {
    // Preserve the status-based message for non-JSON responses.
  }
  return new UserApiError(message, response.status, details);
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
