import { Effect } from 'effect';
import type { RecoveryPorts } from './contract.js';
export function recover(ports: RecoveryPorts) {
  return Effect.gen(function* () {
    const resolution = yield* ports.resolve();
    if (!resolution.classification || !resolution.commit) return { ...resolution, ready: false };
    if (resolution.classification === 'COMPLEX' && !(yield* ports.review(resolution.commit)))
      return { ...resolution, progress: 'Awaiting independent review-loop', ready: false };
    const ready = yield* ports.verify(resolution.commit);
    return { ...resolution, progress: ready ? 'Verified' : 'Awaiting CI', ready };
  });
}
