import type { SourceState, SourceStorePort } from '../../src/capabilities/sources/index.js';

type Selection = Parameters<SourceStorePort['transact']>[3];

/** Controlled persistence keeps the full ledger privately, like the database adapter. */
export function sourceWindow(state: SourceState, selection: Selection): SourceState {
  const window = structuredClone(state);
  if (selection?.kind === 'candidate')
    window.candidates = window.candidates.filter(
      (entry) => entry.candidateId === selection.candidateId
    );
  else if (selection?.kind === 'replay') {
    window.activeCandidateCount = window.candidates.filter(
      (entry) =>
        !['accepted', 'rejected', 'cancelled'].includes(entry.status) &&
        entry.expiresAt > selection.now
    ).length;
    window.candidates = window.candidates.filter((entry) => entry.idempotencyKey === selection.key);
  } else if (selection?.kind === 'membership') window.candidates = [];
  else {
    let end = window.candidates.length;
    let valid = true;
    if (selection?.cursor !== undefined) {
      const match = /^(0|[1-9][0-9]*):(.+)$/.exec(selection.cursor);
      const index = Number(match?.[1]);
      valid =
        !!match &&
        Number.isSafeInteger(index) &&
        window.candidates[index]?.candidateId === match[2];
      end = valid ? index : 0;
    }
    const start = Math.max(0, end - 32);
    const next = window.candidates[start];
    window.candidates = window.candidates.slice(start, end);
    window.candidatePage = {
      valid,
      ...(start > 0 && next ? { nextCursor: `${start}:${next.candidateId}` } : {}),
    };
  }
  return window;
}

export function mergeSourceWindow(prior: SourceState, window: SourceState): SourceState {
  const candidates = new Map(prior.candidates.map((entry) => [entry.candidateId, entry]));
  for (const entry of window.candidates) candidates.set(entry.candidateId, entry);
  const { candidatePage: _page, activeCandidateCount: _count, ...state } = window;
  return structuredClone({ ...state, candidates: [...candidates.values()] });
}
