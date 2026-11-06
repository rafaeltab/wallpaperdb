import type { BoardFailure, BoardMeta } from '../../capabilities/board/index.js';
import type { BoardMeta as WireMeta, FactoryV2Problem } from './contract.js';

export function boardMeta(meta: BoardMeta): WireMeta {
  return {
    coverage: meta.coverage,
    diagnostics: meta.diagnostics,
    factory: meta.factory,
    currentPlanId: meta.currentPlanId,
    dataMode: 'live',
    transport: { changes: true, events: true, suggestedPollMs: 1000 },
  };
}
export function boardProblem(failure: BoardFailure): FactoryV2Problem {
  const responses: Record<
    BoardFailure['reason'],
    { status: number; code: FactoryV2Problem['code'] }
  > = {
    'invalid-input': { status: 400, code: 'invalid-request' },
    'ledger-unavailable': { status: 503, code: 'unavailable' },
    'command-capacity': { status: 503, code: 'unavailable' },
    'action-not-found': { status: 404, code: 'not-found' },
    'action-changed': { status: 412, code: 'stale-action' },
    'command-id-reused': { status: 409, code: 'id-reused' },
    'action-unavailable': { status: 422, code: 'command-rejected' },
    'search-expired': { status: 409, code: 'stale-action' },
  };
  const { status, code } = responses[failure.reason];
  return {
    type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/factory-v2-${code}.md`,
    status,
    code,
    title: code,
    detail: failure.message,
    commandId: failure.commandId,
    retry: code === 'stale-action' ? 'refresh' : code === 'unavailable' ? 'later' : 'never',
  };
}
