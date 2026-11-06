import type { Coverage, Tables } from './model.js';
export function coverageFor(issues: Tables['issues'], providerAvailable: boolean): Coverage {
  const unresolvedIssueIds = Object.values(issues)
    .filter((issue) => issue.metadata.state === 'unknown')
    .map((issue) => issue.id);
  return {
    state: !providerAvailable ? 'unavailable' : unresolvedIssueIds.length ? 'partial' : 'complete',
    reasons: !providerAvailable
      ? [{ code: 'initial', message: 'Provider facts have not been observed.' }]
      : unresolvedIssueIds.length
        ? [{ code: 'missing-context', message: 'Some referenced issues have not been observed.' }]
        : [],
    unresolvedIssueIds,
  };
}
