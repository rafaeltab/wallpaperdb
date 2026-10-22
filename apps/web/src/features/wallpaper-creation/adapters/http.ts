import { getAuthToken } from '@/lib/auth/token-provider';
import type { CreationApi, WallpaperStatus, CandidateStatus } from '../index';
const wallpaperUrl = import.meta.env.VITE_WALLPAPER_URL || '/wallpaper';
const assetUrl = import.meta.env.VITE_ASSET_URL || '/asset';
function object(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error('Invalid service response');
  return Object.fromEntries(Object.entries(input));
}
function status(input: unknown): WallpaperStatus {
  const v = object(input);
  const state = v.state;
  if (
    typeof v.wallpaperId !== 'string' ||
    typeof v.createdAt !== 'string' ||
    (typeof v.assetId !== 'string' && v.assetId !== null) ||
    (typeof v.sourceId !== 'string' && v.sourceId !== null) ||
    (state !== 'creating-asset' &&
      state !== 'awaiting-source' &&
      state !== 'accepting-source' &&
      state !== 'published' &&
      state !== 'failed')
  )
    throw new Error('Invalid Wallpaper response');
  return {
    wallpaperId: v.wallpaperId,
    createdAt: v.createdAt,
    assetId: v.assetId,
    sourceId: v.sourceId,
    state,
  };
}
function candidate(input: unknown): CandidateStatus {
  const v = object(input);
  if (typeof v.candidateId !== 'string' || typeof v.status !== 'string')
    throw new Error('Invalid candidate response');
  return { candidateId: v.candidateId, status: v.status };
}
async function request(url: string, init: RequestInit = {}) {
  const token = await getAuthToken();
  if (!token) throw new Error('Sign in to create a Wallpaper.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Your session expired. Sign in again.'
        : response.status === 413
          ? 'Image exceeds the current upload limit.'
          : response.status === 422
            ? 'Asset rejected this image under its current policy.'
            : response.status === 409
              ? 'This upload conflicts with its current state. Refresh its durable status before retrying.'
              : 'Service unavailable. Your accepted creation remains available in recent creations. Retry with the same file.'
    );
  return response;
}
const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
export function browserCreationApi(): CreationApi<File> {
  return {
    candidateStatus: async (asset, id, signal) =>
      candidate(
        await (
          await request(
            `${assetUrl}/assets/${encodeURIComponent(asset)}/source-candidates/${encodeURIComponent(id)}`,
            { signal }
          )
        ).json()
      ),
    begin: async (key, signal) =>
      status(
        await (
          await request(`${wallpaperUrl}/wallpapers`, {
            method: 'POST',
            ...json({}),
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            signal,
          })
        ).json()
      ),
    status: async (id, signal) =>
      status(
        await (
          await request(`${wallpaperUrl}/wallpapers/${encodeURIComponent(id)}`, { signal })
        ).json()
      ),
    policy: async (signal) => {
      const value = object(
        await (await request(`${assetUrl}/asset-types/wallpaper/policy`, { signal })).json()
      );
      const admission = object(object(value.policy).admission);
      if (
        typeof admission.maxBytes !== 'number' ||
        !Number.isSafeInteger(admission.maxBytes) ||
        admission.maxBytes <= 0
      )
        throw new Error('Invalid Asset upload policy');
      return { maxBytes: admission.maxBytes };
    },
    candidate: async (asset, key, signal) =>
      candidate(
        await (
          await request(`${assetUrl}/assets/${encodeURIComponent(asset)}/source-candidates`, {
            method: 'POST',
            ...json({ operation: 'add', expectedSourceSetRevision: '0' }),
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            signal,
          })
        ).json()
      ),
    expectSource: async (id, candidateId, intentId, signal) => {
      await request(`${wallpaperUrl}/wallpapers/${encodeURIComponent(id)}/first-source`, {
        method: 'PUT',
        ...json({ candidateId, intentId }),
        signal,
      });
    },
    upload: async (asset, id, file, signal) =>
      candidate(
        await (
          await request(
            `${assetUrl}/assets/${encodeURIComponent(asset)}/source-candidates/${encodeURIComponent(id)}/bytes`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: file,
              signal,
            }
          )
        ).json()
      ),
    accept: async (asset, id, intentId, signal) =>
      candidate(
        await (
          await request(
            `${assetUrl}/assets/${encodeURIComponent(asset)}/source-candidates/${encodeURIComponent(id)}/accept`,
            {
              method: 'POST',
              ...json({ operation: 'add', expectedSourceSetRevision: '0' }),
              headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': intentId },
              signal,
            }
          )
        ).json()
      ),
    wait: (signal) =>
      new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException('Cancelled', 'AbortError'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, 1000);
        signal.addEventListener('abort', abort, { once: true });
      }),
    newId: () => crypto.randomUUID(),
  };
}
export async function recentCreations(signal?: AbortSignal): Promise<readonly WallpaperStatus[]> {
  const value = object(await (await request(`${wallpaperUrl}/wallpapers`, { signal })).json());
  if (!Array.isArray(value.wallpapers)) throw new Error('Invalid Wallpaper list');
  return value.wallpapers.map(status);
}
export async function downloadOriginal(wallpaper: WallpaperStatus) {
  if (!wallpaper.assetId || !wallpaper.sourceId) return;
  const response = await request(
    `${assetUrl}/assets/${encodeURIComponent(wallpaper.assetId)}/sources/${encodeURIComponent(wallpaper.sourceId)}/original`
  );
  const filename =
    /filename="([A-Za-z0-9_.-]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ??
    wallpaper.sourceId;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
