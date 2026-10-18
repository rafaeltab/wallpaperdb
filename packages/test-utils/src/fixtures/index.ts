import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

// The stored 120x80 fixtures have six 40x40 blocks: RGB / YMC.
// Pillow 13 + piexif 1.1.3 encoded each admitted format with camera/owner,
// serial/date, GPS, source dimensions and a real 30x20 JPEG thumbnail.
// These literal displayed grids are independent of Sharp's orientation code.
export const orientationCases = [
  { orientation: 'absent', grid: ['RGB', 'YMC'] },
  { orientation: 1, grid: ['RGB', 'YMC'] },
  { orientation: 2, grid: ['BGR', 'CMY'] },
  { orientation: 3, grid: ['CMY', 'BGR'] },
  { orientation: 4, grid: ['YMC', 'RGB'] },
  { orientation: 5, grid: ['RY', 'GM', 'BC'] },
  { orientation: 6, grid: ['YR', 'MG', 'CB'] },
  { orientation: 7, grid: ['CB', 'MG', 'YR'] },
  { orientation: 8, grid: ['BC', 'GM', 'RY'] },
] as const;

export const orientationColors: Readonly<Record<string, readonly number[]>> = {
  R: [255, 0, 0],
  G: [0, 255, 0],
  B: [0, 0, 255],
  Y: [255, 255, 0],
  M: [255, 0, 255],
  C: [0, 255, 255],
};

export function orientationFixture(
  format: 'jpeg' | 'png' | 'webp',
  orientation: number | 'absent'
): Promise<Buffer> {
  return readFile(new URL(`./orientation/${format}-${orientation}.${format}`, import.meta.url));
}

/** Sample block centers so lossy encoders and resize kernels can vary at edges. */
export async function samplePixelGrid(bytes: Uint8Array, columns: number, rows: number) {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      const x = Math.floor(((column + 0.5) * info.width) / columns);
      const y = Math.floor(((row + 0.5) * info.height) / rows);
      const offset = (y * info.width + x) * info.channels;
      return [...data.subarray(offset, offset + 3)];
    })
  );
}
