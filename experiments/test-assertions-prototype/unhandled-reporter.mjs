import { writeFileSync } from "node:fs";

// Vitest's JSON reporter omits unhandled errors. Capture its reporter event too.
export default class UnhandledReporter {
	onTestRunEnd(_modules, errors) {
		writeFileSync(
			process.env.ASSERTIONS_415_ERRORS,
			JSON.stringify(
				errors.map((error) => ({ name: error.name, message: error.message })),
			),
		);
	}
}
