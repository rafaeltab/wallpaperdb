import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { relative } from "node:path";
import { mutationId } from "./mutation-results.mjs";

const atomic = (file, value) => {
	if (!file) return;
	writeFileSync(`${file}.tmp`, JSON.stringify(value));
	renameSync(`${file}.tmp`, file);
};

class ProgressReporter {
	static inject = [];
	start = performance.now();
	progress = {
		total: null,
		completed: 0,
		executed: 0,
		reused: 0,
		errors: 0,
		selectedTests: 0,
		deferred: 0,
	};
	runIds = new Set();
	save() {
		atomic(process.env.WALLPAPERDB_MUTATION_PROGRESS, this.progress);
	}
	onDryRunCompleted() {
		this.progress.startupAndCoverageSeconds =
			(performance.now() - this.start) / 1000;
	}
	onMutationTestingPlanReady({ mutantPlans }) {
		try {
			const gatePath = process.env.WALLPAPERDB_MUTATION_GATE;
			const gate = gatePath
				? new Set(JSON.parse(readFileSync(gatePath, "utf8")))
				: null;
			const report = { schemaVersion: "1.0", files: {}, testFiles: {} };
			for (const plan of mutantPlans) {
				if (!["Run", "EarlyResult"].includes(plan.plan))
					throw new Error("Unsupported Stryker plan shape");
				const { mutant } = plan;
				const name = relative(process.cwd(), mutant.fileName).replaceAll(
					"\\",
					"/",
				);
				report.files[name] ??= {
					source: readFileSync(mutant.fileName, "utf8"),
					mutants: [],
				};
				const file = report.files[name];
				const location = Object.fromEntries(
					["start", "end"].map((end) => [
						end,
						{
							line: mutant.location[end].line + 1,
							column: mutant.location[end].column + 1,
						},
					]),
				);
				const identity = { ...mutant, location };
				const { fileName: _fileName, ...portable } = identity;
				file.mutants.push({ ...portable, status: "Pending" });
				if (gate && !gate.has(mutationId(name, file.source, identity))) {
					// Stryker 10 passes this plan array directly to its executor. Keep its
					// native coverage-selected plans intact for every eligible mutation.
					plan.plan = "EarlyResult";
					plan.mutant = {
						...mutant,
						status: "Ignored",
						statusReason: "Deferred by unit stage",
					};
					this.progress.deferred++;
				} else if (
					plan.plan === "Run" &&
					plan.runOptions.testFilter?.length !== 0
				) {
					this.runIds.add(mutant.id);
					this.progress.selectedTests +=
						plan.runOptions.testFilter?.length ?? 0;
				} else if (plan.plan === "EarlyResult") this.progress.reused++;
			}
			this.progress.total = mutantPlans.length;
			atomic(process.env.WALLPAPERDB_MUTATION_PLAN, report);
		} catch (error) {
			// Reporter exceptions are normally swallowed by Stryker. Fail closed and
			// leave an explicit error for the coordinator instead of running ungated.
			mutantPlans.splice(0);
			this.progress.errors++;
			this.progress.diagnostic = error.message;
		}
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
