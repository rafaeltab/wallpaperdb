import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { command } from "./lib/agent-command.ts";

const repository = "rafaeltab/wallpaperdb";
const recipient = "rafaeltab";
interface Issue {
	number: number;
	body: string;
	state: string;
}

/** Report suspected tooling harm, including incidents subsequently fixed. */
export function reportToolingIncident(input: unknown, run = command) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("Expected a tooling incident object");
	const data = input;
	function field(name: string): string {
		const value: unknown = Reflect.get(data, name);
		if (typeof value !== "string" || !value.trim())
			throw new Error(`Incident requires ${name}`);
		return value.trim();
	}
	const id = field("id");
	const operation = field("operation");
	if (operation !== "create" && operation !== "update")
		throw new Error("Incident operation must be create or update");
	if (!/^[a-z][a-z0-9-]{2,63}$/.test(id))
		throw new Error("Incident id must be a stable lowercase slug");
	const tool = field("tool");
	const sections = [
		"command",
		"expected",
		"observed",
		"impact",
		"workaround",
		"evidence",
		"outcome",
	].map((name) => [name, field(name)]);
	const marker = `<!-- automation-impact:${id} -->`;
	const observation = sections
		.map(
			([name, value]) =>
				`### ${name[0].toUpperCase()}${name.slice(1)}\n\n${value}`,
		)
		.join("\n\n");
	const event = `<!-- observation:${createHash("sha256")
		.update(JSON.stringify([tool, sections]))
		.digest("hex")} -->`;
	// Updates address the verified receipt directly: issue listings can lag writes.
	const issueUrl = operation === "update" ? field("issue") : undefined;
	if (
		issueUrl &&
		!/^https:\/\/github\.com\/rafaeltab\/wallpaperdb\/issues\/\d+$/.test(
			issueUrl,
		)
	)
		throw new Error("Expected an incident issue URL in this repository");
	const pages: Issue[][] = issueUrl
		? [
				[
					JSON.parse(
						run("gh", [
							"api",
							`repos/${repository}/issues/${issueUrl.split("/").at(-1)}`,
						]),
					),
				],
			]
		: JSON.parse(
				run("gh", [
					"api",
					"--paginate",
					"--slurp",
					`repos/${repository}/issues?state=all&labels=automation-impact&per_page=100`,
				]),
			);
	const matches = pages.flat().filter((issue) => issue.body?.includes(marker));
	if (matches.length > 1)
		throw new Error("Multiple incident reports match; inspect remote state");
	const existing = matches[0];
	if (issueUrl && !existing)
		throw new Error("The selected issue does not match this incident id");
	if (
		existing &&
		(!Number.isSafeInteger(existing.number) || existing.number <= 0)
	)
		throw new Error("Invalid incident issue number");
	if (existing && existing.state !== "open")
		throw new Error(
			`Incident #${existing.number} is closed; explain the recurrence and reopen it before reporting`,
		);
	const observationBody = `${event}\n\n${observation}`;
	const body = `${marker}\n\nTool: ${tool}\n\n@${recipient}, this records suspected automation impact. Keep the incident visible even if it is fixed during the task.\n\n${observationBody}`;
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "automation-impact-"),
	);
	try {
		const file = path.join(directory, "body.md");
		fs.writeFileSync(file, body, { mode: 0o600 });
		let url = `https://github.com/${repository}/issues/${existing?.number}`;
		if (existing) {
			const comments: { id: number; body: string }[][] = JSON.parse(
				run("gh", [
					"api",
					"--paginate",
					"--slurp",
					`repos/${repository}/issues/${existing.number}/comments`,
				]),
			);
			const prior = [
				existing.body,
				...comments.flat().map((comment) => comment.body),
			].find((text) => text.includes(event));
			if (prior && !prior.includes(observationBody))
				throw new Error(
					`Previously recorded observation changed: ${url}; inspect remote state`,
				);
			if (!prior) {
				fs.writeFileSync(file, observationBody, { mode: 0o600 });
				const commentUrl = run("gh", [
					"issue",
					"comment",
					String(existing.number),
					"--repo",
					repository,
					"--body-file",
					file,
				]).trim();
				const commentId = commentUrl.startsWith(`${url}#issuecomment-`)
					? commentUrl.match(/#issuecomment-(\d+)$/)?.[1]
					: undefined;
				if (!commentId)
					throw new Error(
						`Ambiguous observation publication: ${url}; inspect remote state before retrying`,
					);
				const comment: { body: string } = JSON.parse(
					run("gh", [
						"api",
						`repos/${repository}/issues/comments/${commentId}`,
					]),
				);
				if (comment.body !== observationBody)
					throw new Error(
						`Observation readback differs: ${url}; inspect remote state before retrying`,
					);
			}
			run("gh", [
				"issue",
				"edit",
				String(existing.number),
				"--repo",
				repository,
				"--add-assignee",
				recipient,
			]);
		} else {
			url = run("gh", [
				"issue",
				"create",
				"--repo",
				repository,
				`--title=Automation impact: ${tool}`,
				"--body-file",
				file,
				"--assignee",
				recipient,
				"--label",
				"automation-impact",
				"--label",
				"bug",
				"--label",
				"needs-triage",
			]).trim();
		}
		if (
			!/^https:\/\/github\.com\/rafaeltab\/wallpaperdb\/issues\/\d+$/.test(url)
		)
			throw new Error(
				"Ambiguous incident publication; inspect remote state before retrying",
			);
		const verified: {
			body: string;
			state: string;
			assignees: { login: string }[];
			labels: { name: string }[];
		} = JSON.parse(
			run("gh", [
				"issue",
				"view",
				url,
				"--repo",
				repository,
				"--json",
				"body,state,assignees,labels",
			]),
		);
		if (
			(!existing && verified.body !== body) ||
			verified.state !== "OPEN" ||
			!verified.assignees.some(({ login }) => login === recipient) ||
			!verified.labels.some(({ name }) => name === "automation-impact")
		)
			throw new Error(
				`Incident notification could not be verified: ${url}. Tell the user; inspect remote state before retrying.`,
			);
		return {
			url,
			userNotice: `AUTOMATION IMPACT: ${tool}. ${field("impact")} Workaround: ${field("workaround")}. Outcome: ${field("outcome")}. Tracked and assigned to @${recipient}: ${url}`,
		};
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}
