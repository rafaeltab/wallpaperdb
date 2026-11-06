import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { command } from "./lib/agent-command.mjs";
export function publishMarkdown(input, run = command) {
	const allowed = new Set([
		"issue-create",
		"issue-edit",
		"issue-comment",
		"pr-create",
		"pr-edit",
		"pr-comment",
		"pr-review",
	]);
	if (!allowed.has(input.kind))
		throw new Error("Unsupported Markdown publication kind");
	const [resource, operation] = input.kind.split("-");
	if (
		operation !== "create" &&
		(!input.subject || String(input.subject).startsWith("-"))
	)
		throw new Error("Expected publication subject");
	const body = fs.readFileSync(input.bodyFile, "utf8");
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "github-body-"));
	const file = path.join(directory, "body.md");
	fs.writeFileSync(file, body, { mode: 0o600 });
	try {
		if (resource === "pr" && operation !== "create") {
			const state = JSON.parse(
				run("gh", ["pr", "view", String(input.subject), "--json", "state"]),
			);
			if (state.state !== "OPEN")
				throw new Error("PR is not open; publication stopped");
		}
		let url;
		let readback;
		if (operation === "review") {
			const pr = JSON.parse(
				run("gh", [
					"pr",
					"view",
					String(input.subject),
					"--json",
					"url,number",
				]),
			);
			const parsed = new URL(pr.url);
			const repo = parsed.pathname.split("/").slice(1, 3).join("/");
			if (parsed.hostname !== "github.com")
				throw new Error("Unsupported GitHub host");
			const endpoint = `repos/${repo}/pulls/${pr.number}/reviews`;
			if (
				!["COMMENT", "APPROVE", "REQUEST_CHANGES"].includes(
					input.event ?? "COMMENT",
				)
			)
				throw new Error("Invalid review event");
			const review = JSON.parse(
				run("gh", ["api", endpoint, "--method", "POST", "--input", "-"], {
					input: JSON.stringify({ body, event: input.event ?? "COMMENT" }),
				}),
			);
			url = review.html_url;
			readback = JSON.parse(
				run("gh", ["api", `${endpoint}/${review.id}`]),
			).body;
		} else {
			const args = [
				resource,
				operation,
				...(operation === "create" ? [] : [String(input.subject)]),
				"--body-file",
				file,
			];
			if (input.title !== undefined) args.push(`--title=${input.title}`);
			if (resource === "pr" && operation === "create") {
				if (input.base) args.push(`--base=${input.base}`);
				if (input.head) args.push(`--head=${input.head}`);
				if (input.draft) args.push("--draft");
			}
			if (input.attach) args.push("--attach", path.resolve(input.attach));
			url = run("gh", args).trim();
			if (operation === "comment") {
				const parsed = new URL(url);
				const id = parsed.hash.match(/^#issuecomment-(\d+)$/)?.[1];
				if (parsed.hostname !== "github.com" || !id)
					throw new Error(
						"Comment publication result is ambiguous; inspect remote state before retrying",
					);
				const repo = parsed.pathname.split("/").slice(1, 3).join("/");
				readback = JSON.parse(
					run("gh", ["api", `repos/${repo}/issues/comments/${id}`]),
				).body;
			} else
				readback = JSON.parse(
					run("gh", [
						resource,
						"view",
						operation === "create" ? url : String(input.subject),
						"--json",
						"body",
					]),
				).body;
		}
		const expected = input.attach
			? body.replace(`![](${input.attach})`, "")
			: body;
		const actual = input.attach
			? String(readback).replace(
					/https:\/\/github\.com\/user-attachments\/assets\/[^\s]+/g,
					"",
				)
			: readback;
		if (actual !== expected)
			throw new Error(
				"Published Markdown readback differs; inspect remote state before retrying",
			);
		return { url, bodyVerified: true };
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}
