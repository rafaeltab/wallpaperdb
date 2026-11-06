import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
function walk(directory) {
	if (!fs.existsSync(directory)) return [];
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.flatMap((e) =>
			e.isDirectory()
				? walk(path.join(directory, e.name))
				: [path.join(directory, e.name)],
		);
}
function prose(source) {
	return source
		.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?^\1\s*$/gm, "")
		.replace(/<!--[\s\S]*?-->/g, "");
}
function anchors(source) {
	const result = new Set();
	const counts = new Map();
	for (const match of prose(source).matchAll(
		/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm,
	)) {
		const slug = match[1]
			.toLowerCase()
			.replace(/<[^>]*>/g, "")
			.replace(/[^\p{L}\p{N}_\-\s]/gu, "")
			.replace(/ /g, "-");
		const count = counts.get(slug) ?? 0;
		counts.set(slug, count + 1);
		result.add(slug + (count ? `-${count}` : ""));
	}
	for (const match of source.matchAll(/\b(?:id|name)=["']([^"']+)["']/g))
		result.add(match[1]);
	return result;
}
export function checkDocumentation(root, files) {
	const errors = [];
	const skills = new Map();
	const headingCache = new Map();
	for (const file of walk(path.join(root, ".agents/skills")).filter(
		(f) => path.basename(f) === "SKILL.md",
	)) {
		const name = fs
			.readFileSync(file, "utf8")
			.match(/^name:\s*["']?([^\s"']+)/m)?.[1];
		if (!name) {
			errors.push(`${file}: missing skill name`);
			continue;
		}
		if (skills.has(name))
			errors.push(
				`${file}: duplicate skill ${name}, also at ${skills.get(name)}`,
			);
		skills.set(name, file);
	}
	for (const file of files) {
		const filename = path.resolve(root, file);
		const source = prose(fs.readFileSync(filename, "utf8"));
		const references = new Map(
			[...source.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm)].map(
				(m) => [m[1].toLowerCase(), m[2]],
			),
		);
		const links = [
			...source.matchAll(
				/!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+["'][^\n]*["'])?\)/g,
			),
		].map((m) => m[1]);
		for (const match of source.matchAll(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
			const key = (match[2] || match[1]).toLowerCase();
			if (!references.has(key))
				errors.push(`${file}: unresolved reference ${key}`);
			else links.push(references.get(key));
		}
		for (const link of links) {
			if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link) || /[<>$*{}]/.test(link))
				continue;
			const [relative, fragment] = link.split("#");
			let target;
			try {
				target = relative
					? path.resolve(
							relative.startsWith("/") ? root : path.dirname(filename),
							decodeURIComponent(relative).replace(/^\//, ""),
						)
					: filename;
			} catch {
				errors.push(`${file}: invalid link ${link}`);
				continue;
			}
			if (!fs.existsSync(target)) {
				errors.push(`${file}: missing link ${link}`);
				continue;
			}
			if (fragment && /\.md$/i.test(target)) {
				if (!headingCache.has(target))
					headingCache.set(target, anchors(fs.readFileSync(target, "utf8")));
				if (!headingCache.get(target).has(decodeURIComponent(fragment)))
					errors.push(`${file}: missing anchor ${link}`);
			}
		}
		for (const match of source
			.replace(/`[^`\n]+`/g, "")
			.matchAll(/\$([a-z][a-z0-9-]*)\b/g)) {
			if (!skills.has(match[1]))
				errors.push(`${file}: unknown skill $${match[1]}`);
		}
	}
	return errors;
}
if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	// Untouched imported skills are exempt. Explicit files cover local edits to them.
	let files = process.argv.slice(2);
	if (files[0] === "--changed") {
		if (files.length !== 2 || files[1].startsWith("-"))
			throw new Error("Expected --changed <base ref>");
		files = execFileSync(
			"git",
			["diff", "--name-only", "--diff-filter=ACMR", "-z", files[1], "--"],
			{ cwd: repository, encoding: "utf8" },
		)
			.split("\0")
			.filter((f) => f.endsWith(".md"));
	}
	const selected = files.length
		? files
		: [
				"AGENTS.md",
				"CODING_STANDARDS.md",
				...walk(path.join(repository, "docs/coding-standards")),
				...walk(path.join(repository, "docs/agents")),
				...walk(path.join(repository, ".agents/skills/wallpaperdb")).filter(
					(f) => f.endsWith(".md"),
				),
			];
	const errors = checkDocumentation(repository, selected);
	if (errors.length) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
	} else
		console.log(
			`Documentation: ${selected.length} files and unique skill names verified.`,
		);
}
