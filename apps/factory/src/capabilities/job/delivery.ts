import type { StageRequest } from './contract.js';

/** Logical initial delivery is zero within each fresh attempt, independently
 * of the attempt's position in the retained job journal. */
export function stageDeliveryIndex(request: StageRequest) {
  return (
    request.deliveryIndex ??
    (request.stage === 'implementation' && request.previousRunId === null ? 0 : request.index)
  );
}
