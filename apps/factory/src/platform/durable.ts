import { randomUUID } from 'node:crypto';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const code = (cause: unknown, expected: string) =>
  cause instanceof Error && 'code' in cause && cause.code === expected;
async function syncDirectory(directory: string) {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export function publisher(directory: string) {
  const publish = async (name: string, value: unknown) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await syncDirectory(dirname(directory));
    const temporary = join(directory, `.${randomUUID()}`);
    const target = join(directory, name);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, target);
      await syncDirectory(directory);
      return true;
    } catch (cause) {
      if (code(cause, 'EEXIST')) {
        await syncDirectory(directory);
        return false;
      }
      throw cause;
    } finally {
      await unlink(temporary);
    }
  };
  return publish;
}
