import { existsSync } from "node:fs";
import { join } from "node:path";
import { git } from "./lib/mutation-state.mjs";

// Preserve standalone workspace opt-ins, including the existing compatibility
// verification. The maintained repository always uses the staged coordinator.
if (
	existsSync(
		join(
			git(process.cwd(), "rev-parse", "--show-toplevel"),
			"mutation.inventory.json",
		),
	)
) {
	const { coordinate } = await import("./lib/mutation-coordinator.mjs");
	try {
		process.exitCode = await coordinate();
	} catch (error) {
		console.error(error.stack);
		process.exitCode = 1;
	}
} else await import("./mutation-single.mjs");
