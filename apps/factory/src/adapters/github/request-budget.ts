import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { githubRequestBudget, stateConnection } from '../../platform/index.js';
import type { RateResponse } from './request-process.js';

const number = z.number().nonnegative().finite().safe();
const sample = z.object({ limit: number, remaining: number, reset: number });
const resource = z.object({ nextAt: number, samples: z.array(sample).max(8) });
const stateSchema = z.object({
  version: z.literal(1),
  blockedUntil: number,
  secondaryFailures: z.number().int().min(0).max(32),
  mutationAt: number.default(0),
  resources: z
    .record(z.string().regex(/^[a-z_]{1,48}$/), resource)
    .refine((r) => Object.keys(r).length <= 16),
});
type State = z.infer<typeof stateSchema>;
type Resource = z.infer<typeof resource>;
const targetFraction = 0.5;
const period = (name: string) => (['search', 'code_search'].includes(name) ? 60_000 : 3_600_000);

export interface RequestClock {
  now(): number;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}
export const requestClock: RequestClock = {
  now: () => Date.now(),
  wait: (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(
        () => {
          signal.removeEventListener('abort', abort);
          resolve();
        },
        Math.min(milliseconds, 2_147_483_647)
      );
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    }),
};

export function requestBudget(directory: string, clock: RequestClock = requestClock) {
  const value = stateConnection(
    directory,
    (db) => db.select().from(githubRequestBudget).where(eq(githubRequestBudget.id, 1)).get()?.value
  );
  let state: State =
    value === undefined
      ? { version: 1, blockedUntil: 0, secondaryFailures: 0, mutationAt: 0, resources: {} }
      : stateSchema.parse(value);
  const save = () => {
    state = stateSchema.parse(state);
    stateConnection(directory, (db) =>
      db
        .insert(githubRequestBudget)
        .values({ id: 1, value: state })
        .onConflictDoUpdate({ target: githubRequestBudget.id, set: { value: state } })
        .run()
    );
  };
  const get = (name: string): Resource => {
    if (!Object.hasOwn(state.resources, name)) {
      if (Object.keys(state.resources).length >= 16 || !/^[a-z][a-z_]{0,47}$/.test(name))
        throw new Error('Unsupported GitHub quota resource');
      state.resources[name] = { nextAt: 0, samples: [] };
    }
    return state.resources[name];
  };
  const interval = (name: string, now: number) => {
    const samples = get(name).samples.filter((s) => s.reset > now);
    return Math.ceil(
      Math.max(
        0,
        ...samples.map((s) =>
          s.limit === 0
            ? Math.max(period(name), s.reset - now + 1000)
            : Math.max(
                period(name) / (s.limit * targetFraction),
                (s.reset - now) / (Math.max(1, s.remaining) * targetFraction)
              )
        )
      )
    );
  };
  const due = (names: readonly string[], now: number) =>
    Math.max(
      state.blockedUntil,
      ...names.flatMap((name) => [
        get(name).nextAt,
        ...get(name)
          .samples.filter((s) => s.remaining === 0 && s.reset > now)
          .map((s) => s.reset + 1000),
      ])
    );
  return {
    known(names: readonly string[]) {
      return names.every((name) =>
        get(name).samples.some((s) => s.limit > 0 && s.reset > clock.now())
      );
    },
    async wait(names: readonly string[], signal: AbortSignal, mutation = false) {
      for (;;) {
        signal.throwIfAborted();
        const delay =
          Math.max(due(names, clock.now()), mutation ? state.mutationAt : 0) - clock.now();
        if (delay <= 0) return;
        await clock.wait(delay, signal);
      }
    },
    reserve(names: readonly string[], cost: number, mutation = false) {
      const now = clock.now();
      const previous = new Map(names.map((name) => [name, get(name).nextAt]));
      for (const name of names)
        get(name).nextAt =
          Math.max(now, get(name).nextAt) +
          (interval(name, now) ? interval(name, now) * cost : 60_000);
      if (mutation) state.mutationAt = Math.max(now, state.mutationAt) + 1000;
      save();
      return { at: now, previous };
    },
    complete(
      reservation: { at: number; previous: Map<string, number> },
      responses: readonly RateResponse[],
      costs: ReadonlyMap<string, number>,
      success: boolean
    ) {
      const now = clock.now();
      const accounted = new Set<string>();
      for (const response of responses) {
        const parsed = sample.safeParse(response);
        if (response.resource && parsed.success) {
          const name = response.resource,
            current = get(name),
            value = parsed.data;
          const previous = current.samples.find((s) => s.reset === value.reset);
          if (previous) value.remaining = Math.min(previous.remaining, value.remaining);
          const remaining = current.samples.filter((s) => s.reset > now && s.reset !== value.reset);
          current.samples = [...remaining, value].slice(-8);
          if (remaining.length >= 8)
            state.blockedUntil = Math.max(
              state.blockedUntil,
              Math.max(...remaining.map((s) => s.reset))
            );
          accounted.add(name);
        }
        if (response.retryAfter !== undefined || [403, 429].includes(response.status)) {
          if (response.remaining === 0 && response.reset && response.reset > now) continue;
          state.secondaryFailures = Math.min(32, state.secondaryFailures + 1);
          const after = response.retryAfter;
          const retry =
            after === undefined
              ? NaN
              : /^\d+(?:\.\d+)?$/.test(after)
                ? now + Number(after) * 1000
                : Date.parse(after);
          const until = Number.isFinite(retry)
            ? retry
            : now + 60_000 * 2 ** Math.min(6, state.secondaryFailures - 1);
          state.blockedUntil = Math.max(state.blockedUntil, until);
        }
      }
      if (accounted.size) {
        for (const [name, before] of reservation.previous) get(name).nextAt = before;
        for (const name of accounted) {
          const current = get(name),
            cost = costs.get(name) ?? 2;
          current.nextAt = Math.max(now, current.nextAt) + interval(name, now) * cost;
        }
      }
      if (success && state.blockedUntil <= now) state.secondaryFailures = 0;
      save();
    },
  };
}
