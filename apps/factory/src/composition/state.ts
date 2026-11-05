import { initializeState } from '../platform/index.js';
export async function compatibleState(directory: string) {
  try {
    initializeState(directory, true);
  } catch (cause) {
    throw new Error(
      'Unreadable or unsupported factory state format. Select a compatible installation; preserve state and do not delete claims.',
      { cause }
    );
  }
}
