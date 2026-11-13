// Temporary #682 diagnostic. No extra requests or scheduling changes.
import { appendFileSync } from 'node:fs';

export function flake682(kind: string, data: object) {
  const destination = process.env.DIAG682_LOG;
  if (destination)
    appendFileSync(
      destination,
      JSON.stringify({ at: Date.now(), pid: process.pid, kind, ...data }) + '\n'
    );
}
