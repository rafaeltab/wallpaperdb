import type { SourceOperations, SourcePolicy } from './contract.js';
/** One owner for operational normalization, shared by trusted configuration and
 * direct capability/adapter consumers. These ceilings do not qualify capacity. */
export function resolveSourceOperations(input: Partial<SourceOperations> = {}): SourceOperations {
  return {
    readLifetimeMs: input.readLifetimeMs ?? 300000,
    reclamationTimeoutMs: input.reclamationTimeoutMs ?? 5000,
  };
}
export const initialSourcePolicies = {
  wallpaper: {
    maxActiveSources: 16,
    maxCandidates: 2,
    aspectRatioTolerance: 0.03,
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
    aspectRatioTolerance: 0.03,
    operations: ['add', 'replace-set'],
    admission: {
      maxBytes: 5242880,
      maxPixels: 262144,
      maxAxis: 512,
      squareSize: 512,
      sourceModels: ['sdr-webp', 'animated-sdr-webp'],
    },
    retention: { evidenceMs: 2592000000, candidateMs: 86400000 },
    temporaryInput: { maxBytes: 52428800, abandonedMs: 86400000 },
  },
} satisfies Record<string, SourcePolicy>;
