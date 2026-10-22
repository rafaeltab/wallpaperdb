import { Effect } from 'effect';
import { Creation, WorkflowDelivery } from '../../capabilities/creation/index.js';
import { decodeConfirmation } from './translation.js';
import { observeWorkflow } from './observation.js';
/** Only trusted operator composition exposes replay of retained valid input. */
export const recoverConfirmation = (id: string) =>
  Effect.gen(function* () {
    const delivery = yield* WorkflowDelivery;
    const payload = yield* delivery.retainedConfirmation(id);
    if (payload === null) return false;
    const decoded = decodeConfirmation(new TextEncoder().encode(payload));
    if (decoded.kind === 'invalid') return false;
    const creation = yield* Creation;
    yield* observeWorkflow(
      'wallpaper.workflow.recover-confirmation',
      decoded.context,
      {
        'event.consumer': 'trusted-wallpaper-operator',
        'event.delivery_attempt': 1,
        'recovery.id': id,
      },
      Effect.gen(function* () {
        const outcome =
          decoded.kind === 'created'
            ? yield* creation.assetResult(decoded.result)
            : yield* creation.sourceAccepted(decoded.confirmation);
        yield* delivery.confirmationRecovered(id);
        return outcome;
      })
    );
    return true;
  });
