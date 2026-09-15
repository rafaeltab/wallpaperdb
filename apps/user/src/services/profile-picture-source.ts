import { isIP } from 'node:net';

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
  let source = trustedSource(url, options.allowedHosts);
  const signal = AbortSignal.timeout(options.timeoutMs);
  let redirects = 0;
  while (true) {
    const response = await fetcher(source.href, {
      redirect: 'manual',
      headers: { Accept: 'image/jpeg, image/png, image/webp' },
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (redirects++ >= 3) throw new PermanentPictureImportError('Initial picture has too many redirects');
      const location = response.headers.get('location');
      if (!location) throw new PermanentPictureImportError('Initial picture redirect is invalid');
      try {
        source = trustedSource(new URL(location, source).href, options.allowedHosts);
      } catch {
        throw new PermanentPictureImportError('Initial picture redirect is not allowed');
      }
      continue;
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
