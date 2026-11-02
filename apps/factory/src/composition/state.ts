import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publisher } from '../platform/index.js';

// Format 1 includes pre-manifest immutable records. This release does not rewrite them.
export async function compatibleState(directory: string) {
  const publish = publisher(directory);
  await publish('format.json', { format: 1 });
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(join(directory, 'format.json'), 'utf8'));
  } catch (cause) {
    throw new Error(
      'Unreadable factory state format. Select a compatible installation; preserve the state directory and investigate filesystem or JSON corruption.',
      { cause }
    );
  }
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('format' in manifest) ||
    manifest.format !== 1
  )
    throw new Error(
      'Unsupported factory state format. Select a compatible installation; preserve the state directory and do not delete claims.'
    );
}
