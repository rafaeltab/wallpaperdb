export const requiredChecks = ['Build, Lint, and Test', 'E2E Tests', 'Container E2E Tests'];
/** The same current-head CI policy gates publication and prerequisite reuse. */
export function passingChecks(checks: readonly { name: string; success: boolean }[]) {
  return (
    requiredChecks.every(
      (name) =>
        checks.some((check) => check.name === name) &&
        checks.filter((check) => check.name === name).every((check) => check.success)
    ) && checks.filter((check) => check.name.startsWith('codecov/')).every((check) => check.success)
  );
}

export function normalizeChecks(
  checks: readonly (
    | { name: string; status: string; conclusion: string | null }
    | { context: string; state: string }
  )[]
) {
  return checks.map((check) =>
    'name' in check
      ? {
          name: check.name,
          success: check.status === 'COMPLETED' && check.conclusion === 'SUCCESS',
        }
      : { name: check.context, success: check.state === 'SUCCESS' }
  );
}
