import type { AvailableFormat } from './contract.js';

/** Availability announces supported image renditions. Other immutable originals
 * remain retrievable but cannot be represented by the availability contract. */
export function availableFormat(mimeType: string): AvailableFormat | null {
  return mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp'
    ? mimeType
    : null;
}
