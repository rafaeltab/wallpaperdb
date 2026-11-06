import { expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { checkDocumentation } from "./check-documentation.ts";
test("documentation resolves links, duplicate headings, references and unique skills", (t) => {
	const root = mkdtempSync(join(tmpdir(), "docs-check-"));
	t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
	const write = (p: string, s: string) => {
		const file = join(root, p);
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, s);
	};
	write(
		".agents/skills/wallpaperdb/example/SKILL.md",
		"---\nname: example\ndescription: Example\n---\n# Example\n",
	);
	write("target.md", "# A heading\n# A heading\n");
	write(
		"guide.md",
		"[ok](target.md#a-heading-1)\n[ref][target]\n[target]: target.md\nUse $example.\n```sh\n[example](missing.md)\n```\n",
	);
	expect(checkDocumentation(root, ["guide.md"])).toStrictEqual([]);
	write("name (draft).md", "# A *formatted* heading\n");
	write(
		"guide.md",
		"[nested [label]](<name (draft).md#a-formatted-heading>)\n\n    [code](missing.md)\n",
	);
	expect(checkDocumentation(root, ["guide.md"])).toStrictEqual([]);
	write(
		"guide.md",
		"[bad](target.md#missing)\n[absent](absent.md)\nUse $unknown-skill.\n",
	);
	expect(checkDocumentation(root, ["guide.md"]).length).toBe(3);
	write("guide.md", "Use `$unknown-skill` for this task.");
	expect(checkDocumentation(root, ["guide.md"]).length).toBe(1);
	write(".agents/skills/example/SKILL.md", "---\nname: example\n---\n");
	expect(
		checkDocumentation(root, []).some((e) => e.includes("duplicate skill")),
	).toBeTruthy();
});
