export type Issue = {
  number: number;
  title: string;
  branch: string;
};

export function parsePlan(rawPlan: string): Issue[] {
  const parsed = JSON.parse(rawPlan) as { issues?: unknown };
  if (!Array.isArray(parsed.issues)) {
    throw new Error(`Planner returned an invalid issue plan: ${rawPlan}`);
  }

  for (const candidate of parsed.issues) {
    const issue = candidate as Partial<Issue>;
    if (
      !Number.isInteger(issue.number) ||
      typeof issue.title !== "string" ||
      issue.branch !== `sandcastle/issue-${issue.number}`
    ) {
      throw new Error(`Planner returned an invalid issue plan: ${rawPlan}`);
    }
  }

  return parsed.issues as Issue[];
}
