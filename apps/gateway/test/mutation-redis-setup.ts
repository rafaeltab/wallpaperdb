// Only the mutation config loads this file. Vitest isolation reruns it before
// every mutant while application modules and clients receive fresh lifetimes.
import { writeFileSync } from 'node:fs';
if (process.env.WALLPAPERDB_MUTATION_RESET) {
  try {
    const response = await fetch(process.env.WALLPAPERDB_MUTATION_RESET, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Owned mutation fixture reset failed');
  } catch (error) {
    // Suite setup errors can look like kills to Stryker. Keep an independent
    // worker receipt so a slow/disconnected controller cannot create evidence.
    const receipt = process.env.WALLPAPERDB_MUTATION_FAILURE_FILE;
    const deadline = Number(process.env.WALLPAPERDB_MUTATION_EXECUTION_DEADLINE);
    if (receipt && Date.now() < deadline) writeFileSync(receipt, '{"failed":true}');
    throw error;
  }
}
