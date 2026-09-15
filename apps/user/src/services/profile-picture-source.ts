export class PermanentPictureImportError extends Error {}

export interface InitialPictureDownloadOptions {
  maxBytes: number;
  timeoutMs: number;
  allowedHosts: string[];
}

export async function downloadInitialPicture(
  url: string,
  options: InitialPictureDownloadOptions,
  fetcher: typeof fetch = fetch
): Promise<Buffer> {
  const response = await fetcher(url, {
    redirect: 'manual',
    headers: { Accept: 'image/jpeg, image/png, image/webp' },
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  return Buffer.from(await response.arrayBuffer());
}
