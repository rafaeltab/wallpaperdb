export type PlannedIssue = {
  number: number;
  title: string;
  branch: string;
  plan: string;
};

export function parsePlan(rawPlan: string): PlannedIssue | undefined {
  const parsed = JSON.parse(rawPlan) as { issue?: unknown };
  if (parsed.issue === null || parsed.issue === undefined) return undefined;

  const issue = parsed.issue as Partial<PlannedIssue>;
  if (
    !Number.isInteger(issue.number) ||
    typeof issue.title !== "string" ||
    issue.branch !== `sandcastle/issue-${issue.number}` ||
    typeof issue.plan !== "string" ||
    issue.plan.trim().length === 0
  ) {
    throw new Error(`Planner returned an invalid issue plan: ${rawPlan}`);
  }

  return issue as PlannedIssue;
}
