import { writeFileSync } from "node:fs";
import { retryFailure } from "./checks.mjs";

export default class RetryReporter {
	results = [];
	onTestCaseResult(test) {
		this.results.push({
			name: test.fullName,
			...test.diagnostic(),
			result: test.result(),
		});
	}
	onTestRunEnd() {
		writeFileSync(
			process.env.STABILITY_ATTEMPTS,
			JSON.stringify(this.results, null, 2),
		);
		if (
			process.env.STABILITY_STRICT_RETRIES === "1" &&
			retryFailure(this.results)
		) {
			console.error("PROTOTYPE #418: a failed attempt recovered on retry");
			process.exitCode = 1;
		}
	}
}
