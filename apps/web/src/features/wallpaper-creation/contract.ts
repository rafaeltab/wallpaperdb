export interface WallpaperStatus {
  readonly wallpaperId: string;
  readonly state:
    | 'creating-asset'
    | 'awaiting-source'
    | 'accepting-source'
    | 'published'
    | 'failed';
  readonly assetId: string | null;
  readonly sourceId: string | null;
  readonly createdAt: string;
}
export interface CandidateStatus {
  readonly candidateId: string;
  readonly status: string;
}
export interface CreationApi<TFile> {
  readonly candidateStatus: (
    asset: string,
    candidate: string,
    signal: AbortSignal
  ) => Promise<CandidateStatus>;
  readonly begin: (key: string, signal: AbortSignal) => Promise<WallpaperStatus>;
  readonly status: (id: string, signal: AbortSignal) => Promise<WallpaperStatus>;
  readonly policy: (signal: AbortSignal) => Promise<{ readonly maxBytes: number }>;
  readonly candidate: (asset: string, key: string, signal: AbortSignal) => Promise<CandidateStatus>;
  readonly expectSource: (
    wallpaper: string,
    candidate: string,
    intent: string,
    signal: AbortSignal
  ) => Promise<void>;
  readonly upload: (
    asset: string,
    candidate: string,
    file: TFile,
    signal: AbortSignal
  ) => Promise<CandidateStatus>;
  readonly accept: (
    asset: string,
    candidate: string,
    intent: string,
    signal: AbortSignal
  ) => Promise<CandidateStatus>;
  readonly wait: (signal: AbortSignal) => Promise<void>;
  readonly newId: () => string;
}
export type CreationOutcome = {
  readonly kind: 'published' | 'pending';
  readonly wallpaper: WallpaperStatus;
};
