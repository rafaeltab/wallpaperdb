export class PermanentPictureImportError extends Error {}

export interface InitialPictureDownloadOptions {
  maxBytes: number;
  timeoutMs: number;
  allowedHosts: string[];
}

function trustedSource(url: string, allowedHosts: string[]): URL {
  let source: URL;
  try {
    source = new URL(url);
  } catch {
    throw new PermanentPictureImportError('Initial picture source is invalid');
  }
  if (source.protocol !== 'https:' || source.username || source.password || source.port ||
    source.hostname.startsWith('[') || isIP(source.hostname) || !allowedHosts.includes(source.hostname)) {
    throw new PermanentPictureImportError('Initial picture source is not allowed');
  }
  return source;
}

export async function downloadInitialPicture(
  url: string,
  options: InitialPictureDownloadOptions,
  fetcher: typeof fetch = fetch
): Promise<Buffer> {
  trustedSource(url, options.allowedHosts);
  const response = await fetcher(url, {
    redirect: 'manual',
    headers: { Accept: 'image/jpeg, image/png, image/webp' },
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  return Buffer.from(await response.arrayBuffer());
}
import { isIP } from 'node:net';
