export type Issue = {
    number: number;
    title: string;
    branch: string;
}

export function parsePlan(plan: string): Issue[] {
    const planMatch = plan.match(/<plan>([\s\S]*?)<\/plan>/);
    if (!planMatch) {
        throw new Error(
            "Orchestrator did not produce a <plan> tag.\n\n" + plan,
        );
    }

    const { issues } = JSON.parse(planMatch[1]) as {
        issues: { number: number; title: string; branch: string }[];
    };
    return issues;
}
