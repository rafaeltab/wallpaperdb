import { writeFileSync } from "node:fs";

// A new private output directory and nonce are supplied for every process.
export default class CompletenessReporter {
	onTestRunEnd(modules, errors, reason) {
		writeFileSync(
			process.env.COMPLETENESS_RECEIPT,
			JSON.stringify({
				nonce: process.env.COMPLETENESS_NONCE,
				reason,
				errors: errors.map((e) => e.message),
				files: modules.map((module) => ({
					path: module.moduleId,
					project: module.project.name,
					state: module.state(),
					errors: module
						.errors()
						.map((error) => ({
							message: error.message,
							stack: error.stack,
							cause: error.cause,
						})),
					tests: [...module.children.allTests()].map((test) => ({
						name: test.fullName,
						state: test.result().state,
					})),
				})),
			}),
		);
	}
}
