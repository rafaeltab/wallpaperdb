import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { COLOR_ANCHORS, COLOR_ANCHORS_SHA256 } from '@wallpaperdb/events/color-vocabulary';
import { expect, it } from 'vitest';

const reference = JSON.parse(
  await readFile(new URL('./fixtures/prototype/expected.json', import.meta.url), 'utf8')
);

it('retains the exact anchor bank, traversal order and original IDs', () => {
  expect(createHash('sha256').update(JSON.stringify(COLOR_ANCHORS)).digest('hex')).toBe(
    reference.anchorSha256
  );
  expect(COLOR_ANCHORS_SHA256).toBe(reference.anchorSha256);
});
