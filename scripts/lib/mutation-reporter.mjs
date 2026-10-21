import { writeFileSync, renameSync } from "node:fs";

class ProgressReporter {
	static inject = [];
	progress = { total: null, completed: 0, executed: 0, errors: 0 };
	runIds = new Set();
	save() {
		const file = process.env.WALLPAPERDB_MUTATION_PROGRESS;
		writeFileSync(`${file}.tmp`, JSON.stringify(this.progress));
		renameSync(`${file}.tmp`, file);
	}
	onMutationTestingPlanReady({ mutantPlans }) {
		this.progress.total = mutantPlans.length;
		this.runIds = new Set(
			mutantPlans.filter((p) => p.plan === "Run").map((p) => p.mutant.id),
		);
		this.save();
	}
	onMutantTested(result) {
		this.progress.completed++;
		if (this.runIds.has(result.id)) this.progress.executed++;
		if (result.status === "RuntimeError") this.progress.errors++;
		this.save();
	}
}
export const strykerPlugins = [
	{
		kind: "Reporter",
		name: "checkpoint-progress",
		injectableClass: ProgressReporter,
	},
];
