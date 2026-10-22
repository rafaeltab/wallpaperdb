/** Author policy values are admission limits, never measured native processing budgets. */
export interface SourcePolicy {
  readonly maxActiveSources: number;
  readonly maxCandidates: number;
  readonly operations: readonly ('add' | 'replace-one' | 'replace-set')[];
  readonly admission: {
    readonly maxBytes: number;
    readonly maxPixels: number;
    readonly maxAxis: number;
    readonly squareSize?: number;
    readonly sourceModels: readonly string[];
  };
  readonly retention: { readonly evidenceMs: number; readonly candidateMs: number };
  readonly temporaryInput: { readonly maxBytes: number; readonly abandonedMs: number };
}
export const initialSourcePolicies = {
  wallpaper: {
    maxActiveSources: 16,
    maxCandidates: 2,
    operations: ['add', 'replace-one'],
    admission: {
      maxBytes: 52428800,
      maxPixels: 100000000,
      maxAxis: 20000,
      sourceModels: ['sdr-jpeg', 'sdr-png', 'sdr-webp'],
    },
    retention: { evidenceMs: 604800000, candidateMs: 86400000 },
    temporaryInput: { maxBytes: 52428800, abandonedMs: 86400000 },
  },
  picture: {
    maxActiveSources: 1,
    maxCandidates: 2,
    operations: ['add', 'replace-set'],
    admission: {
      maxBytes: 5242880,
      maxPixels: 262144,
      maxAxis: 512,
      squareSize: 512,
      sourceModels: ['sdr-webp'],
    },
    retention: { evidenceMs: 2592000000, candidateMs: 86400000 },
    temporaryInput: { maxBytes: 52428800, abandonedMs: 86400000 },
  },
} satisfies Record<string, SourcePolicy>;
