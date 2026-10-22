import type { CreationApi, CreationOutcome, WallpaperStatus } from './contract';
export async function uploadFirstSource<TFile>(
  api: CreationApi<TFile>,
  file: { readonly value: TFile; readonly size: number },
  key: string,
  signal: AbortSignal
): Promise<CreationOutcome> {
  signal.throwIfAborted();
  const policy = await api.policy(signal);
  if (file.size > policy.maxBytes)
    throw new Error('Image exceeds the current Asset upload policy.');
  let wallpaper = await api.begin(key, signal);
  const waitFor = async (predicate: (w: WallpaperStatus) => boolean) => {
    for (let i = 0; i < 30 && !predicate(wallpaper); i++) {
      if (wallpaper.state === 'failed') throw new Error('Wallpaper creation was rejected.');
      await api.wait(signal);
      wallpaper = await api.status(wallpaper.wallpaperId, signal);
    }
    return predicate(wallpaper);
  };
  if (wallpaper.state === 'published') return { kind: 'published', wallpaper };
  if (!(await waitFor((w) => w.assetId !== null))) return { kind: 'pending', wallpaper };
  const asset = wallpaper.assetId;
  if (!asset) return { kind: 'pending', wallpaper };
  let candidate = await api.candidate(asset, `${key}-source`, signal);
  for (let i = 0; i < 30 && ['inspecting', 'accepting'].includes(candidate.status); i++) {
    await api.wait(signal);
    candidate = await api.candidateStatus(asset, candidate.candidateId, signal);
  }
  if (['inspecting', 'accepting'].includes(candidate.status)) return { kind: 'pending', wallpaper };
  if (candidate.status === 'rejected' || candidate.status === 'cancelled')
    throw new Error(
      'The retained upload candidate cannot be accepted. Select the file again to start a new creation.'
    );
  const intent = key;
  // Register intent durably before any acceptance can generate its confirmation.
  await api.expectSource(wallpaper.wallpaperId, candidate.candidateId, intent, signal);
  if (candidate.status === 'awaiting-bytes') {
    const uploaded = await api.upload(asset, candidate.candidateId, file.value, signal);
    if (uploaded.status === 'rejected' || uploaded.status === 'cancelled')
      throw new Error('Asset rejected this image. Check its supported format and dimensions.');
    candidate = uploaded;
    for (let i = 0; i < 30 && candidate.status === 'inspecting'; i++) {
      await api.wait(signal);
      candidate = await api.candidateStatus(asset, candidate.candidateId, signal);
    }
    if (candidate.status !== 'ready' && candidate.status !== 'accepted')
      return { kind: 'pending', wallpaper };
  }
  const accepted =
    candidate.status === 'accepted'
      ? candidate
      : await api.accept(asset, candidate.candidateId, intent, signal);
  if (accepted.status === 'rejected' || accepted.status === 'cancelled')
    throw new Error('Asset did not accept this Source. Check recent creations before retrying.');
  if (accepted.status !== 'accepted') return { kind: 'pending', wallpaper };
  if (!(await waitFor((w) => w.state === 'published'))) return { kind: 'pending', wallpaper };
  return { kind: 'published', wallpaper };
}
