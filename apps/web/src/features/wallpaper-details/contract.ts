export interface VariantSelection {
  wallpaperId: string;
  index: number;
}
export type DetailCommand =
  | { kind: 'toggle-panel' | 'close-panel' | 'download' | 'share' }
  | { kind: 'select'; index: number };
export interface SharePort {
  share?: (url: string) => Promise<void>;
  copy: (url: string) => Promise<void>;
}
