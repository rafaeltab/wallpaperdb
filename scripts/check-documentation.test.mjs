import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkDocumentation } from "./check-documentation.mjs";
test("documentation resolves links, duplicate headings, references and unique skills", (t) => {
	const root = mkdtempSync(join(tmpdir(), "docs-check-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const write = (p, s) => {
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
	assert.deepEqual(checkDocumentation(root, ["guide.md"]), []);
	write("name (draft).md", "# A *formatted* heading\n");
	write(
		"guide.md",
		"[nested [label]](<name (draft).md#a-formatted-heading>)\n\n    [code](missing.md)\n",
	);
	assert.deepEqual(checkDocumentation(root, ["guide.md"]), []);
	write(
		"guide.md",
		"[bad](target.md#missing)\n[absent](absent.md)\nUse $unknown-skill.\n",
	);
	assert.equal(checkDocumentation(root, ["guide.md"]).length, 3);
	write(".agents/skills/example/SKILL.md", "---\nname: example\n---\n");
	assert.ok(
		checkDocumentation(root, []).some((e) => e.includes("duplicate skill")),
	);
});
