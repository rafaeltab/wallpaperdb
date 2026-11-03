// Fixed Asset case/assertion evaluator extracted from the reviewed #547 assessor.
import { stripVTControlCharacters } from "node:util";
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const refuse = (reason) => {
	throw new Error(reason);
};
export function refuseTestSetup(out, err, selection) {
	// This wrapper is evidence of the exact Vitest command failing, never an outcome verdict.
	const expectedVitestWrapper = (line) => {
		const m = line
			.trim()
			.match(
				/^ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL\s+Command failed with exit code 1:\s+(.+)$/,
			);
		if (!m) return false;
		const words = m[1].trim().split(/\s+/);
		if (words.shift() !== "vitest" || words.shift() !== "run") return false;
		const at = words.indexOf("--config");
		if (at < 0 || words[at + 1] !== "vitest.integration.config.ts")
			return false;
		words.splice(at, 2);
		return equal(
			words.sort(),
			["--maxWorkers=1", "--no-file-parallelism", ...selection].sort(),
		);
	};
	const setupView = `${out}\n${err}`
		.split("\n")
		.filter((line) => !expectedVitestWrapper(line))
		.join("\n");
	if (
		/Failed Suites|No test files|Failed to (?:load|resolve)|Cannot find (?:module|package)|ERR_PNPM|SyntaxError:|ReferenceError:|Unhandled Errors|unhandled rejection/i.test(
			setupView,
		)
	)
		refuse("SETUP_OR_COLLECTION");
}

export function assessAssetBaseline(stdout, stderr, contract) {
	const out = stripVTControlCharacters(
		new TextDecoder("utf-8", { fatal: true }).decode(stdout),
	);
	const err = stripVTControlCharacters(
		new TextDecoder("utf-8", { fatal: true }).decode(stderr),
	);
	refuseTestSetup(out, err, ["test/broker-acquisition"]);
	const expected = contract.expectedCaseSet;
	const key = (x) => JSON.stringify([x.project, x.file, x.name]);
	const wanted = new Map(expected.map((x) => [key(x), x]));
	if (
		expected.length !== 18 ||
		wanted.size !== 18 ||
		expected.filter((x) => x.result === "failed").length !== 16
	)
		refuse("EXPECTED_CONTRACT");
	const observed = new Map();
	let current = null,
		files = new Set();
	for (const line of out.split("\n")) {
		const file = line.match(/^\s*[❯✓]\s+(\S+)\s+(test\/[^\s]+\.ts)\s+\(/);
		if (file) {
			if (file[1] !== "asset-integration") refuse("CASE_SET");
			current = file[2];
			files.add(current);
			continue;
		}
		const test = line.match(/^\s*([✓×])\s+(.+?)\s+\d+(?:\.\d+)?m?s\s*$/);
		if (test) {
			const k = JSON.stringify(["asset-integration", current, test[2]]);
			if (observed.has(k) || !wanted.has(k)) refuse("CASE_SET");
			const status = test[1] === "×" ? "failed" : "passed";
			if (wanted.get(k).result !== status) refuse("CASE_OUTCOME");
			observed.set(k, status);
		}
	}
	if (
		files.size !== 6 ||
		observed.size !== 18 ||
		!/Test Files\s+6 failed\s*\(6\)/.test(out) ||
		!/Tests\s+16 failed\s*\|\s*2 passed\s*\(18\)/.test(out)
	)
		refuse("CASE_SET");
	assessBaselineAssertions(err, expected);
	return { files: 6, collected: 18, failed: 16, passed: 2 };
}

export function assessBaselineAssertions(err, expected) {
	const wanted = new Map(
		expected.map((x) => [JSON.stringify([x.project, x.file, x.name]), x]),
	);
	const failures = new Map();
	let pending = [];
	for (const line of err.split("\n")) {
		const m = line.match(
			/^\s*FAIL\s+(\S+)\s+(test\/[^\s]+\.ts)\s+>\s+(.+?)\s*$/,
		);
		if (m) {
			const k = JSON.stringify([m[1], m[2], m[3]]);
			if (failures.has(k) || pending.includes(k)) refuse("ASSERTION_CASE_SET");
			pending.push(k);
			continue;
		}
		if (pending.length) {
			if (line.includes("AssertionError:")) {
				if (!/AssertionError:\s+expected 1 to be \+0/.test(line))
					refuse("ASSERTION_FAMILY");
				for (const k of pending)
					failures.set(k, { assertion: true, anchor: false });
			}
			for (const k of pending) {
				const x = failures.get(k),
					w = wanted.get(k);
				if (w?.result !== "failed") refuse("ASSERTION_CASE_SET");
				if (x && line.includes(w.assertionAnchor)) x.anchor = true;
			}
			if (/⎯.*\[\d+\/\d+\]/.test(line)) {
				for (const k of pending)
					if (!failures.get(k)?.anchor) refuse("ASSERTION_ANCHOR");
				pending = [];
			}
		}
	}
	if (
		pending.length ||
		failures.size !== expected.filter((c) => c.result === "failed").length
	)
		refuse("ASSERTION_CASE_SET");
	for (const [k, w] of wanted)
		if (
			w.result === "failed" &&
			(!failures.get(k)?.assertion || !failures.get(k)?.anchor)
		)
			refuse("ASSERTION_FAMILY");
}
