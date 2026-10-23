import { Effect } from 'effect';
import {
  PictureAttachments,
  AttachmentDelivery,
} from '../../capabilities/picture-attachments/index.js';
import { decodeConfirmation } from './translation.js';
import { observeWorkflow } from './observation.js';
/** Only trusted operator composition exposes replay of retained valid input. */
export const recoverConfirmation = (id: string) =>
  Effect.gen(function* () {
    const delivery = yield* AttachmentDelivery;
    const payload = yield* delivery.retainedConfirmation(id);
    if (payload === null) return false;
    const decoded = decodeConfirmation(new TextEncoder().encode(payload));
    if (decoded.kind === 'invalid') return false;
    const attachments = yield* PictureAttachments;
    const result = yield* observeWorkflow(
      'user.workflow.recover-confirmation',
      decoded.context,
      {
        'event.consumer': 'trusted-user-operator',
        'event.delivery_attempt': 1,
        'recovery.id': id,
      },
      Effect.gen(function* () {
        const outcome =
          decoded.kind === 'result'
            ? yield* attachments.assetResult(decoded.result)
            : yield* attachments.sourceAccepted(decoded.confirmation);
        if (outcome !== 'requires-attention') yield* delivery.confirmationRecovered(id);
        return outcome;
      })
    );
    return result !== 'requires-attention';
  });
