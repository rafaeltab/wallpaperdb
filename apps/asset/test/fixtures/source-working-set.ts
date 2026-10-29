import type { CandidateSelection, SourceState } from '../../src/capabilities/sources/index.js';

export function workingSet(state: SourceState, selection?: CandidateSelection): SourceState {
  const copy = structuredClone(state);
  if (selection?.kind === 'candidate')
    copy.candidates = copy.candidates.filter((c) => c.candidateId === selection.candidateId);
  else if (selection?.kind === 'create') {
    const replay = copy.candidates.find((c) => c.idempotencyKey === selection.idempotencyKey);
    const pending = copy.candidates
      .filter(
        (c) =>
          !['accepted', 'rejected', 'cancelled'].includes(c.status) &&
          Date.parse(c.expiresAt) > selection.now
      )
      .slice(0, selection.limit);
    copy.candidates = [
      ...new Map([...(replay ? [replay] : []), ...pending].map((c) => [c.candidateId, c])).values(),
    ];
  } else if (selection?.kind === 'page') {
    let end = copy.candidates.length;
    let valid = true;
    if (selection.cursor !== undefined) {
      const split = selection.cursor.indexOf(':');
      const position = selection.cursor.slice(0, split);
      end = Number(position);
      valid =
        selection.cursor.length <= 256 &&
        split > 0 &&
        /^(0|[1-9][0-9]*)$/.test(position) &&
        Number.isSafeInteger(end) &&
        copy.candidates[end]?.candidateId === selection.cursor.slice(split + 1);
    }
    const start = Math.max(0, end - 32);
    const anchor = copy.candidates[start];
    copy.candidatePage = {
      valid,
      ...(valid && start > 0 && anchor ? { nextCursor: `${start}:${anchor.candidateId}` } : {}),
    };
    copy.candidates = valid ? copy.candidates.slice(start, end).reverse() : [];
  } else copy.candidates = [];
  return copy;
}
export function commitWorkingSet(prior: SourceState, changed: SourceState): SourceState {
  const candidates = new Map(prior.candidates.map((c) => [c.candidateId, c]));
  for (const candidate of changed.candidates) candidates.set(candidate.candidateId, candidate);
  const { candidatePage: _page, ...membership } = changed;
  return structuredClone({ ...membership, candidates: [...candidates.values()] });
}
