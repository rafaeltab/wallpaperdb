import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { reportToolingIncident } from "./report-tooling-incident.ts";

const incident = {
	operation: "create",
	id: "generator-cache-baseline",
	tool: "scripts/check-generated.ts",
	command: "make run PACKAGE=scripts SCRIPT=check:generated ARGS=routes",
	expected: "A clean cached build passes",
	observed: "Missing ignored routes are reported stale",
	impact: "Valid PR blocked",
	workaround: "none",
	evidence: "https://github.com/rafaeltab/wallpaperdb/actions/runs/123",
	outcome: "blocked",
};

test("updates require and directly address the original receipt even when listings lag", () => {
	expect(() =>
		reportToolingIncident({ ...incident, operation: "update" }, () => {
			throw new Error("unexpected network");
		}),
	).toThrow(/issue/);
	let original = "";
	reportToolingIncident(incident, (_program, args) => {
		if (args[0] === "api") return "[]";
		if (args[1] === "create") {
			original = readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
			return "https://github.com/rafaeltab/wallpaperdb/issues/123";
		}
		return JSON.stringify({
			body: original,
			state: "OPEN",
			assignees: [{ login: "rafaeltab" }],
			labels: [{ name: "automation-impact" }],
		});
	});
	const result = reportToolingIncident(
		{
			...incident,
			operation: "update",
			issue: "https://github.com/rafaeltab/wallpaperdb/issues/123",
		},
		(_program, args) => {
			if (args[0] === "api") {
				const endpoint = args.at(-1);
				if (endpoint === "repos/rafaeltab/wallpaperdb/issues/123")
					return JSON.stringify({ body: original, number: 123, state: "open" });
				if (endpoint?.endsWith("/comments")) return "[]";
				throw new Error(
					"An update must not discover its target through a lagging issue listing",
				);
			}
			if (args[1] === "create" || args[1] === "comment")
				throw new Error("Repeated observation should not publish again");
			return JSON.stringify({
				body: original,
				state: "OPEN",
				assignees: [{ login: "rafaeltab" }],
				labels: [{ name: "automation-impact" }],
			});
		},
	);
	expect(result.url).toBe(
		"https://github.com/rafaeltab/wallpaperdb/issues/123",
	);
});

test("concurrent reporters preserve both independently verified observations", () => {
	let body =
		"<!-- automation-impact:generator-cache-baseline -->\nEarlier observation";
	const comments: { body: string; id: number }[] = [];
	let interleaved = false;
	const run = (_program: string, args: readonly string[]): string => {
		const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
		if (endpoint.includes("?state=all")) {
			const snapshot = JSON.stringify([[{ body, number: 123, state: "open" }]]);
			if (!interleaved) {
				interleaved = true;
				reportToolingIncident({ ...incident, observed: "Observation B" }, run);
			}
			return snapshot;
		}
		if (endpoint.endsWith("/comments")) return JSON.stringify([comments]);
		if (endpoint.includes("/issues/comments/"))
			return JSON.stringify(
				comments.find(
					(comment) => String(comment.id) === endpoint.split("/").at(-1),
				),
			);
		if (args[1] === "edit" && args.includes("--body-file"))
			body = readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
		if (args[1] === "comment") {
			const id = comments.length + 1;
			comments.push({
				id,
				body: readFileSync(args[args.indexOf("--body-file") + 1], "utf8"),
			});
			return `https://github.com/rafaeltab/wallpaperdb/issues/123#issuecomment-${id}`;
		}
		return JSON.stringify({
			body,
			state: "OPEN",
			assignees: [{ login: "rafaeltab" }],
			labels: [{ name: "automation-impact" }],
		});
	};
	reportToolingIncident({ ...incident, observed: "Observation A" }, run);
	const history = [body, ...comments.map((comment) => comment.body)].join("\n");
	expect(history).toContain("Observation A");
	expect(history).toContain("Observation B");
});
test("publishes an assigned, labeled incident as data and returns an explicit user notice", () => {
	let body = "";
	const calls: string[][] = [];
	const result = reportToolingIncident(incident, (_program, args) => {
		calls.push([...args]);
		if (args[0] === "api") return "[]";
		if (args[0] === "issue" && args[1] === "create") {
			body = readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
			return "https://github.com/rafaeltab/wallpaperdb/issues/123";
		}
		return JSON.stringify({
			body,
			state: "OPEN",
			assignees: [{ login: "rafaeltab" }],
			labels: [{ name: "automation-impact" }],
		});
	});
	expect(body).toContain(incident.observed);
	expect(body).toContain("Workaround");
	expect(calls.find((args) => args[1] === "create")).toContain("rafaeltab");
	expect(result.userNotice).toContain("AUTOMATION IMPACT");
	expect(result.userNotice).toContain("/issues/123");
});

test("reuses an open incident and preserves earlier observations", () => {
	let body =
		"<!-- automation-impact:generator-cache-baseline -->\nEarlier observation";
	let creates = 0;
	const comments: { id: number; body: string }[] = [];
	const run = (_program: string, args: readonly string[]) => {
		const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
		if (endpoint.endsWith("/comments")) return JSON.stringify([comments]);
		if (endpoint.includes("/issues/comments/"))
			return JSON.stringify(
				comments.find(
					(comment) => String(comment.id) === endpoint.split("/").at(-1),
				),
			);
		if (args[0] === "api")
			return JSON.stringify([[{ body, number: 123, state: "open" }]]);
		if (args[1] === "create") creates++;
		if (args[1] === "comment") {
			const id = comments.length + 1;
			comments.push({
				id,
				body: readFileSync(args[args.indexOf("--body-file") + 1], "utf8"),
			});
			return `https://github.com/rafaeltab/wallpaperdb/issues/123#issuecomment-${id}`;
		}
		return JSON.stringify({
			body,
			state: "OPEN",
			assignees: [{ login: "rafaeltab" }],
			labels: [{ name: "automation-impact" }],
		});
	};
	reportToolingIncident(incident, run);
	const first = body;
	reportToolingIncident(incident, run);
	expect(creates).toBe(0);
	expect(body).toBe(first);
	expect(body).toContain("Earlier observation");
	expect(comments).toHaveLength(1);
});

test("rejects incomplete reports before publication and fails when notification cannot be verified", () => {
	expect(() =>
		reportToolingIncident({ ...incident, workaround: "" }, () => {
			throw new Error("unexpected network call");
		}),
	).toThrow(/workaround/i);
	let body = "";
	expect(() =>
		reportToolingIncident(incident, (_program, args) => {
			if (args[0] === "api") return "[]";
			if (args[1] === "create") {
				body = readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
				return "https://github.com/rafaeltab/wallpaperdb/issues/123";
			}
			return JSON.stringify({ body, state: "OPEN", assignees: [], labels: [] });
		}),
	).toThrow(/verify|verified/i);
});

test("keeps closed incidents visible and refuses ambiguous duplicate identities", () => {
	const body = "<!-- automation-impact:generator-cache-baseline -->";
	for (const issues of [
		[{ body, number: 123, state: "closed" }],
		[
			{ body, number: 123, state: "open" },
			{ body, number: 124, state: "open" },
		],
	]) {
		let writes = 0;
		expect(() =>
			reportToolingIncident(incident, (_program, args) => {
				if (args[0] === "api") return JSON.stringify([issues]);
				writes++;
				return "";
			}),
		).toThrow(/closed|Multiple/);
		expect(writes).toBe(0);
	}
});

test("takes incident text as body data and requires exact publication readback", () => {
	let published = "";
	const observed = "Broken `check` with $(private-command)\n\nnew paragraph";
	const invoke = (different: boolean) =>
		reportToolingIncident({ ...incident, observed }, (_program, args) => {
			if (args[0] === "api") return "[]";
			if (args[1] === "create") {
				published = readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
				return "https://github.com/rafaeltab/wallpaperdb/issues/123";
			}
			return JSON.stringify({
				body: different ? "truncated" : published,
				state: "OPEN",
				assignees: [{ login: "rafaeltab" }],
				labels: [{ name: "automation-impact" }],
			});
		});
	invoke(false);
	expect(published).toContain(observed);
	expect(() => invoke(true)).toThrow(/verified/);
});
