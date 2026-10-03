type DownloadVariant = { url: string; width: number; height: number; format: string };
export interface DownloadPorts<Payload> {
  openCache(): Promise<{
    read(url: string): Promise<Payload | undefined>;
    write(url: string, payload: Payload): Promise<void>;
  }>;
  fetchPayload(url: string): Promise<Payload>;
  save(payload: Payload, filename: string): void;
}
export async function downloadWallpaper<Payload>(
  variant: DownloadVariant,
  ports: DownloadPorts<Payload>
): Promise<void> {
  let cache: Awaited<ReturnType<DownloadPorts<Payload>['openCache']>> | null;
  try {
    cache = await ports.openCache();
  } catch {
    cache = null;
  }
  let payload = await cache?.read(variant.url);
  if (payload === undefined) {
    payload = await ports.fetchPayload(variant.url);
    await cache?.write(variant.url, payload);
  }
  const ext = variant.format.split('/')[1];
  ports.save(
    payload,
    `wallpaper-${variant.width}x${variant.height}.${ext === 'jpeg' ? 'jpg' : ext}`
  );
}
