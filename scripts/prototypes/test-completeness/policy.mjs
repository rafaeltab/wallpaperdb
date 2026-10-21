// PROTOTYPE #417. Observations come from current files and fresh runner processes.
export function evaluate(
	input,
	exceptions = [],
	today = new Date().toISOString().slice(0, 10),
) {
	const findings = [...input.findings];
	const add = (code, target, detail) => findings.push({ code, target, detail });
	for (const file of input.files) {
		if (file.role === "test" && !file.discovered.length)
			add(
				"undiscovered",
				file.path,
				"No pilot runner discovers this maintained test",
			);
		if (
			file.role !== "fixture" &&
			/\.[cm]?tsx?$/.test(file.path) &&
			!file.typedBy.length
		)
			add(
				"untyped",
				file.path,
				"Not included by a check-types project in the CI graph",
			);
	}
	for (const suite of input.suites) {
		if (!suite.inGraph)
			add(
				"ci-task",
				suite.task,
				`No executable task in the CI graph for ${suite.id}`,
			);
		if (suite.role === "expected" && !suite.files.length)
			add("empty-suite", suite.id, "Expected suite discovers no test files");
		for (const file of suite.files) {
			if (!suite.ciFiles.includes(file))
				add(
					"ci-omission",
					file,
					`Discovered by ${suite.id}, omitted by its CI command`,
				);
		}
	}
	for (const run of input.executions) {
		if (!run.nonce || run.nonce !== run.expectedNonce)
			add(
				"stale-report",
				run.id,
				"Execution receipt is not from this invocation",
			);
		for (const key of run.expectedFiles) {
			if (!run.files.some((file) => file.key === key))
				add("unexecuted", key, "Selected file has no execution receipt");
		}
		for (const file of run.files) {
			if (!file.tests.length)
				add("empty-file", file.key, "A selected test file registered no tests");
			for (const test of file.tests) {
				if (["skipped", "pending", "todo", "disabled"].includes(test.state))
					add("runtime-skip", `${file.key}::${test.name}`, test.state);
				else if (test.state !== "passed")
					add("test-failure", `${file.key}::${test.name}`, test.state);
			}
		}
	}
	const failures = [];
	const allowed = [];
	const valid = [];
	const codes = new Set([
		"focused",
		"disabled",
		"undiscovered",
		"untyped",
		"ci-task",
		"ci-omission",
		"empty-suite",
		"empty-file",
		"runtime-skip",
	]);
	for (const exception of exceptions) {
		const { code, target, owner, issue, reason, expires } = exception;
		const date =
			/^\d{4}-\d{2}-\d{2}$/.test(expires ?? "") &&
			!Number.isNaN(Date.parse(expires)) &&
			new Date(expires).toISOString().slice(0, 10) === expires;
		if (
			!codes.has(code) ||
			typeof target !== "string" ||
			!target.trim() ||
			/[*?]/.test(target) ||
			!/^@[\w-]+$/.test(owner ?? "") ||
			!/^https:\/\/github.com\/[\w-]+\/[\w.-]+\/issues\/\d+$/.test(
				issue ?? "",
			) ||
			typeof reason !== "string" ||
			!reason.trim() ||
			!date ||
			expires <= today ||
			valid.some((e) => e.code === code && e.target === target)
		) {
			failures.push({
				code: "invalid-exception",
				target: target ?? "",
				detail: JSON.stringify(exception),
			});
		} else valid.push(exception);
	}
	for (const finding of findings) {
		const exception = valid.find(
			(e) => e.code === finding.code && e.target === finding.target,
		);
		if (exception) allowed.push({ ...finding, exception });
		else failures.push(finding);
	}
	for (const exception of valid) {
		if (!allowed.some((f) => f.exception === exception))
			failures.push({
				code: "unused-exception",
				target: exception.target,
				detail: "Remove obsolete exception",
			});
	}
	return { failures, allowed };
}
