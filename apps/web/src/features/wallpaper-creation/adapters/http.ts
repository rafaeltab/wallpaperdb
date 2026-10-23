import { getAuthToken } from '@/lib/auth/token-provider';
import {
  SourceIntakeError,
  type SourceBatchApi,
  type ManagedCandidate,
  type OwnedSources,
  type CreationApi,
  type WallpaperStatus,
  type CandidateStatus,
} from '../index';
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
    ...(typeof v.candidateId === 'string' ? { candidateId: v.candidateId } : {}),
    ...(v.attentionRequired === true ? { attentionRequired: true } : {}),
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
  if (response.status === 409)
    throw new SourceIntakeError(
      'Sources changed or their current limit was reached. Retry this file against the current set.',
      true
    );
  if (response.status === 413 || response.status === 422)
    throw new SourceIntakeError(
      response.status === 413
        ? 'Image exceeds the current upload limit.'
        : 'Asset rejected this image under its current policy.',
      true
    );
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
export async function uploadPolicy(
  signal: AbortSignal
): Promise<{ maxBytes: number; maxPixels: number; maxAxis: number }> {
  const value = object(
    await (await request(`${assetUrl}/asset-types/wallpaper/policy`, { signal })).json()
  );
  const admission = object(object(value.policy).admission);
  const positive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  if (
    !positive(admission.maxBytes) ||
    !positive(admission.maxPixels) ||
    !positive(admission.maxAxis)
  )
    throw new Error('Invalid Asset upload policy');
  return {
    maxBytes: admission.maxBytes,
    maxPixels: admission.maxPixels,
    maxAxis: admission.maxAxis,
  };
}
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
    policy: uploadPolicy,
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
  };
}
export async function recentCreations(signal?: AbortSignal): Promise<readonly WallpaperStatus[]> {
  const value = object(await (await request(`${wallpaperUrl}/wallpapers`, { signal })).json());
  if (!Array.isArray(value.wallpapers)) throw new Error('Invalid Wallpaper list');
  const wallpapers = value.wallpapers.map(status);
  const result: WallpaperStatus[] = [];
  // Keep progress lookups bounded while Asset retains authority for candidate facts.
  for (const wallpaper of wallpapers) {
    if (wallpaper.state !== 'accepting-source' || !wallpaper.assetId || !wallpaper.candidateId) {
      result.push(wallpaper);
      continue;
    }
    try {
      const current = candidate(
        await (
          await request(
            `${assetUrl}/assets/${encodeURIComponent(wallpaper.assetId)}/source-candidates/${encodeURIComponent(wallpaper.candidateId)}`,
            { signal }
          )
        ).json()
      );
      result.push({ ...wallpaper, candidateStatus: current.status });
    } catch (error) {
      if (signal?.aborted) throw error;
      result.push({ ...wallpaper, candidateStatus: 'unavailable' });
    }
  }
  return result;
}
export async function downloadOriginal(wallpaper: WallpaperStatus, signal: AbortSignal) {
  if (!wallpaper.assetId || !wallpaper.sourceId) return;
  return downloadSourceOriginal(wallpaper.assetId, wallpaper.sourceId, signal);
}
export async function downloadSourceOriginal(
  assetId: string,
  sourceId: string,
  signal: AbortSignal
) {
  const response = await request(
    `${assetUrl}/assets/${encodeURIComponent(assetId)}/sources/${encodeURIComponent(sourceId)}/original`,
    { signal }
  );
  const filename =
    /filename="([A-Za-z0-9_.-]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ??
    sourceId;
  const blob = await response.blob();
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function managedCandidate(input: unknown): ManagedCandidate {
  const v = object(input);
  if (
    typeof v.candidateId !== 'string' ||
    typeof v.expectedSourceSetRevision !== 'string' ||
    !/^(0|[1-9][0-9]{0,39})$/.test(v.expectedSourceSetRevision) ||
    typeof v.status !== 'string' ||
    ![
      'awaiting-bytes',
      'inspecting',
      'ready',
      'accepting',
      'accepted',
      'rejected',
      'cancelled',
    ].includes(v.status) ||
    (v.status === 'accepted' && typeof v.sourceId !== 'string')
  )
    throw new Error('Invalid Source candidate response');
  return {
    candidateId: v.candidateId,
    expectedSourceSetRevision: v.expectedSourceSetRevision,
    status: v.status,
    ...(typeof v.sourceId === 'string' ? { sourceId: v.sourceId } : {}),
    ...(typeof v.reason === 'string' ? { reason: v.reason } : {}),
  };
}
export async function ownedSources(asset: string, signal: AbortSignal): Promise<OwnedSources> {
  const v = object(
    await (
      await request(`${assetUrl}/assets/${encodeURIComponent(asset)}/sources`, { signal })
    ).json()
  );
  if (
    typeof v.sourceSetRevision !== 'string' ||
    !/^(0|[1-9][0-9]{0,39})$/.test(v.sourceSetRevision) ||
    !Array.isArray(v.sources) ||
    !Array.isArray(v.candidates)
  )
    throw new Error('Invalid owned Sources response');
  return {
    sourceSetRevision: v.sourceSetRevision,
    candidates: v.candidates.map(managedCandidate),
    sources: v.sources.map((input) => {
      const s = object(input),
        facts = object(s.facts);
      if (
        typeof s.sourceId !== 'string' ||
        typeof facts.width !== 'number' ||
        typeof facts.height !== 'number'
      )
        throw new Error('Invalid accepted Source response');
      return { sourceId: s.sourceId, facts: { width: facts.width, height: facts.height } };
    }),
  };
}
export function browserSourceBatchApi(): SourceBatchApi<File> {
  const creation = browserCreationApi();
  const path = (asset: string, id: string) =>
    `${assetUrl}/assets/${encodeURIComponent(asset)}/source-candidates/${encodeURIComponent(id)}`;
  return {
    identifier: () => crypto.randomUUID(),
    begin: creation.begin,
    wallpaper: creation.status,
    list: ownedSources,
    expectSource: creation.expectSource,
    wait: creation.wait,
    create: async (asset, key, revision, signal) =>
      managedCandidate(
        await (
          await request(`${assetUrl}/assets/${encodeURIComponent(asset)}/source-candidates`, {
            method: 'POST',
            ...json({ operation: 'add', expectedSourceSetRevision: revision }),
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            signal,
          })
        ).json()
      ),
    status: async (asset, id, signal) =>
      managedCandidate(await (await request(path(asset, id), { signal })).json()),
    upload: async (asset, id, file, signal) =>
      managedCandidate(
        await (
          await request(`${path(asset, id)}/bytes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file,
            signal,
          })
        ).json()
      ),
    accept: async (asset, id, revision, correlation, signal) =>
      managedCandidate(
        await (
          await request(`${path(asset, id)}/accept`, {
            method: 'POST',
            ...json({ operation: 'add', expectedSourceSetRevision: revision }),
            headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': correlation },
            signal,
          })
        ).json()
      ),
    cancel: async (asset, id, signal) => {
      await request(path(asset, id), { method: 'DELETE', signal });
    },
  };
}
