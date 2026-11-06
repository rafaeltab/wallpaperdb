import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
const repository = fileURLToPath(new URL("../", import.meta.url));
const parser = unified().use(remarkParse);
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
function visit(node, callback) {
	callback(node);
	for (const child of node.children ?? []) visit(child, callback);
}
function text(node) {
	return node.value ?? (node.children ?? []).map(text).join("");
}
function anchors(tree) {
	const result = new Set();
	const counts = new Map();
	visit(tree, (node) => {
		if (node.type === "heading") {
			const slug = text(node)
				.toLowerCase()
				.replace(/<[^>]*>/g, "")
				.replace(/[^\p{L}\p{N}_\-\s]/gu, "")
				.replace(/ /g, "-");
			const count = counts.get(slug) ?? 0;
			counts.set(slug, count + 1);
			result.add(slug + (count ? `-${count}` : ""));
		}
		if (node.type === "html")
			for (const match of node.value.matchAll(
				/\b(?:id|name)=["']([^"']+)["']/g,
			))
				result.add(match[1]);
	});
	return result;
}
export function checkDocumentation(root, files) {
	const errors = [];
	const skills = new Map();
	const trees = new Map();
	const headings = new Map();
	const tree = (filename) => {
		if (!trees.has(filename))
			trees.set(
				filename,
				parser.parse(
					fs
						.readFileSync(filename, "utf8")
						.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ""),
				),
			);
		return trees.get(filename);
	};
	for (const filename of walk(path.join(root, ".agents/skills")).filter(
		(f) => path.basename(f) === "SKILL.md",
	)) {
		const name = fs
			.readFileSync(filename, "utf8")
			.match(/^name:\s*["']?([^\s"']+)/m)?.[1];
		if (!name) {
			errors.push(`${filename}: missing skill name`);
			continue;
		}
		if (skills.has(name))
			errors.push(
				`${filename}: duplicate skill ${name}, also at ${skills.get(name)}`,
			);
		skills.set(name, filename);
	}
	for (const file of files) {
		const filename = path.resolve(root, file);
		const source = tree(filename);
		const references = new Map();
		const links = [];
		visit(source, (node) => {
			if (node.type === "definition") references.set(node.identifier, node.url);
		});
		visit(source, (node) => {
			if (node.type === "link" || node.type === "image") links.push(node.url);
			if (node.type === "linkReference" || node.type === "imageReference") {
				if (references.has(node.identifier))
					links.push(references.get(node.identifier));
				else errors.push(`${file}: unresolved reference ${node.identifier}`);
			}
			if (
				node.type === "inlineCode" &&
				/^\$[a-z][a-z0-9-]*$/.test(node.value) &&
				!skills.has(node.value.slice(1))
			)
				errors.push(`${file}: unknown skill ${node.value}`);
			if (node.type === "text")
				for (const match of node.value.matchAll(/\$([a-z][a-z0-9-]*)\b/g))
					if (!skills.has(match[1]))
						errors.push(`${file}: unknown skill $${match[1]}`);
		});
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
				if (!headings.has(target)) headings.set(target, anchors(tree(target)));
				if (!headings.get(target).has(decodeURIComponent(fragment)))
					errors.push(`${file}: missing anchor ${link}`);
			}
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
