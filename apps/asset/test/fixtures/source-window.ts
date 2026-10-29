import type { CandidateSelection, SourceState } from '../../src/capabilities/sources/index.js';

/** Controlled persistence keeps full history privately and exposes the same selected window. */
export function sourceWindow(
  state: SourceState,
  selection: CandidateSelection = { kind: 'page' }
): SourceState {
  const selected = structuredClone(state);
  selected.candidateSequence = state.candidates.length;
  if (selection.kind === 'candidate')
    selected.candidates = selected.candidates.filter((c) => c.candidateId === selection.id);
  else if (selection.kind === 'replay') {
    selected.liveCandidateCount = selected.candidates.filter(
      (c) =>
        !['accepted', 'rejected', 'cancelled'].includes(c.status) &&
        Date.parse(c.expiresAt) > Date.parse(selection.now)
    ).length;
    selected.candidates = selected.candidates.filter((c) => c.idempotencyKey === selection.key);
  } else {
    let end = selected.candidates.length;
    let valid = true;
    if (selection.cursor !== undefined) {
      const match = /^(0|[1-9][0-9]*):(.+)$/.exec(selection.cursor);
      end = match ? Number(match[1]) : -1;
      valid =
        selection.cursor.length <= 256 &&
        Number.isSafeInteger(end) &&
        end >= 0 &&
        selected.candidates[end]?.candidateId === match?.[2];
    }
    const start = valid ? Math.max(0, end - 32) : 0;
    selected.candidates = valid ? selected.candidates.slice(start, end) : [];
    selected.candidateWindow = { start, valid };
  }
  return selected;
}
export function mergeSourceWindow(prior: SourceState, changed: SourceState): SourceState {
  const candidates = new Map(prior.candidates.map((c) => [c.candidateId, c]));
  for (const candidate of changed.candidates) candidates.set(candidate.candidateId, candidate);
  const state = {
    ...structuredClone(changed),
    candidates: structuredClone([...candidates.values()]),
  };
  delete state.candidateWindow;
  delete state.liveCandidateCount;
  delete state.candidateSequence;
  return state;
}
