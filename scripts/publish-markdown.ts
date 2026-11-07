interface Publication {
	kind: string;
	subject?: string | number;
	bodyFile: string;
	title?: string;
	base?: string;
	head?: string;
	draft?: boolean;
	attach?: string;
	event?: string;
}
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { command } from "./lib/agent-command.ts";
export function publishMarkdown(input: Publication, run = command) {
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
			const state: { state: string } = JSON.parse(
				run("gh", ["pr", "view", String(input.subject), "--json", "state"]),
			);
			if (state.state !== "OPEN")
				throw new Error("PR is not open; publication stopped");
		}
		let url: string;
		let readback: unknown;
		if (operation === "review") {
			const pr: { url: string; number: number } = JSON.parse(
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
			const review: { html_url: string; id: number } = JSON.parse(
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
		let verified = readback === body;
		if (input.attach) {
			const marker = `![](${input.attach})`;
			const parts = body.split(marker);
			if (parts.length !== 2)
				throw new Error("Expected exactly one attachment reference");
			const [before, after] = parts;
			const uploaded = String(readback).slice(
				before.length,
				String(readback).length - after.length,
			);
			verified =
				String(readback).startsWith(before) &&
				String(readback).endsWith(after) &&
				/^https:\/\/github\.com\/user-attachments\/assets\/[^\s]+$/.test(
					uploaded,
				);
		}
		if (!verified)
			throw new Error(
				"Published Markdown readback differs; inspect remote state before retrying",
			);
		return { url, bodyVerified: true };
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}
