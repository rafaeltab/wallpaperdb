import { Clock, Effect, Layer } from 'effect';
import { type AdmissionResult, Quota } from '../../admission/index.js';

class MemoryQuota implements Quota {
  private readonly windows = new Map<string, { count: number; reset: number }>();
  readonly take = Effect.fn('admission.local_quota')(function* (
    this: MemoryQuota,
    profileId: string,
    limit: number,
    windowMs: number
  ): Effect.fn.Return<Exclude<AdmissionResult, { _tag: 'Unauthorized' }>> {
    const now = yield* Clock.currentTimeMillis;
    for (const [id, window] of this.windows) if (window.reset <= now) this.windows.delete(id);
    const window = this.windows.get(profileId) ?? { count: 0, reset: now + windowMs };
    if (window.count >= limit)
      return {
        _tag: 'Limited',
        retryAfter: Math.ceil((window.reset - now) / 1000),
        reset: window.reset,
      };
    window.count++;
    this.windows.set(profileId, window);
    return { _tag: 'Allowed', remaining: limit - window.count, reset: window.reset };
  });
}
export const memoryQuotaLayer = Layer.sync(Quota, () => new MemoryQuota());
