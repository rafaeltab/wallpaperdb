import { Effect } from 'effect';
import type { Control, JobStore, Observation, StageRequest } from './contract.js';

export function recoverManualRepair(store: JobStore) {
  return Effect.gen(function* () {
    const control = yield* store.readControl();
    const origin = control.manualRepair;
    const request = origin?.adoption;
    if (
      request &&
      origin &&
      (control.restart?.index ?? 0) <= origin.index &&
      request.repairOrigin === origin.index &&
      request.threadId === origin.threadId
    )
      yield* store.saveStage(request);
  });
}

export function retainManualRepair(
  store: JobStore,
  stage: StageRequest,
  run: { readonly id: string; readonly ordinal: number }
) {
  return Effect.gen(function* () {
    for (;;) {
      const control = yield* store.readControl();
      if (
        control.cancelled ||
        control.prerequisite ||
        control.parked?.index === stage.index ||
        (control.restart?.index ?? 0) > stage.index ||
        (yield* store.readStage(stage.index + 1))
      )
        return;
      const prior = control.manualRepair;
      if (
        prior?.threadId === stage.threadId &&
        (prior.index === stage.index ||
          (stage.repairOrigin === prior.index && stage.observedRunId !== undefined))
      )
        return;
      if (
        yield* store.saveControl({
          ...control,
          revision: control.revision + 1,
          manualRepair: { index: stage.index, threadId: stage.threadId, run },
        })
      )
        return;
    }
  });
}

export function adoptManualRepair(
  store: JobStore,
  stage: StageRequest,
  observed: Extract<Observation, { kind: 'found' }>,
  control: Control
) {
  return Effect.gen(function* () {
    const origin = control.manualRepair;
    const run = observed.run;
    if (
      control.cancelled ||
      control.prerequisite ||
      control.parked?.index === stage.index ||
      stage.stage !== 'implementation' ||
      !origin ||
      !run ||
      origin.threadId !== stage.threadId ||
      observed.threadId !== stage.threadId ||
      (origin.index !== stage.index && stage.repairOrigin !== origin.index)
    )
      return undefined;
    const previous =
      stage.index === origin.index
        ? origin.run
        : stage.observedRunId && stage.ordinal
          ? { id: stage.observedRunId, ordinal: stage.ordinal }
          : undefined;
    if (!previous || run.id === previous.id || run.ordinal <= previous.ordinal) return undefined;
    const request: StageRequest = {
      ...stage,
      index: stage.index + 1,
      ordinal: run.ordinal,
      previousRunId: previous.id,
      observedRunId: run.id,
      question: observed.question,
      deliveryIndex: stage.deliveryIndex ?? stage.index,
      resume: false,
      repairOrigin: origin.index,
    };
    // Linearize against cancellation and fresh Retry before writing the stage.
    // The intent survives a crash between these independently replay-safe steps.
    if (
      !(yield* store.saveControl({
        ...control,
        revision: control.revision + 1,
        manualRepair: { ...origin, adoption: request },
      }))
    )
      return undefined;
    yield* store.saveStage(request);
    const saved = yield* store.readStage(request.index);
    return saved?.stage === request.stage &&
      saved.threadId === request.threadId &&
      saved.ordinal === run.ordinal &&
      saved.observedRunId === run.id &&
      saved.repairOrigin === origin.index
      ? saved
      : undefined;
  });
}
