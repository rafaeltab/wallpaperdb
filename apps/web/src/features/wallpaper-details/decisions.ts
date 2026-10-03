import type { VariantSelection, DetailCommand, SharePort } from './contract';
export function resolveVariantIndex(
  selection: VariantSelection,
  wallpaperId: string,
  count: number
): number {
  return selection.wallpaperId === wallpaperId
    ? Math.max(0, Math.min(selection.index, count - 1))
    : 0;
}
export function detailShortcut(
  key: string,
  typing: boolean,
  state: { panelOpen: boolean; index: number; count: number }
): DetailCommand | undefined {
  if (typing) return;
  switch (key.toLowerCase()) {
    case 'i':
      return { kind: 'toggle-panel' };
    case 'escape':
      return state.panelOpen ? { kind: 'close-panel' } : undefined;
    case 'd':
      return state.count > 0 ? { kind: 'download' } : undefined;
    case 's':
      return state.count > 0 ? { kind: 'share' } : undefined;
    case 'arrowleft':
      return state.index > 0 ? { kind: 'select', index: state.index - 1 } : undefined;
    case 'arrowright':
      return state.index < state.count - 1 ? { kind: 'select', index: state.index + 1 } : undefined;
  }
}
export async function shareWallpaperLink(
  url: string,
  port: SharePort
): Promise<'shared' | 'copied' | 'failed'> {
  if (port.share) {
    try {
      await port.share(url);
      return 'shared';
    } catch {}
  }
  try {
    await port.copy(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
