import { command } from '../../platform/index.js';
/** Read object ancestry without changing any branch or operator-selected pin. */
export async function ancestor(
  project: string,
  parent: string,
  child: string,
  signal?: AbortSignal
) {
  try {
    await command('git', ['merge-base', '--is-ancestor', parent, child], project, signal);
    return true;
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 1) return false;
    throw cause;
  }
}
