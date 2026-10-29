import { Effect } from 'effect';
import { z } from 'zod';
import { type Time, Unavailable } from '../../capabilities/job/index.js';
export const systemTime: Time = {
  now: () =>
    Effect.try({
      try: () => z.number().int().nonnegative().safe().parse(Date.now()),
      catch: (cause) => new Unavailable({ operation: 'clock', cause }),
    }).pipe(Effect.tapError((error) => Effect.logError(error))),
};
