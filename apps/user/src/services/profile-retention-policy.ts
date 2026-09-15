import type { Config } from '../config.js';

export function profileEvidenceRetentionMs(
  config: Pick<Config, 'profileEvidenceRetentionDays'>
): number {
  return config.profileEvidenceRetentionDays * 24 * 60 * 60 * 1000;
}
