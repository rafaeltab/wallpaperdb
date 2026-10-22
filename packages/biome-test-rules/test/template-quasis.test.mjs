import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

const pluginDiagnostics = (source) =>
	lint(source).filter((d) => d.category === "plugin");

test("interpolated template members retain empty boundary quasis", () => {
	for (const expression of [
		"expect[`poll${name}`](() => 1).toBe(1)",
		"expect[`${name}poll`](() => 1).toBe(1)",
		"expect(1)[`${name}toBe`](1)",
	])
		assert.deepEqual(
			pluginDiagnostics(`import { expect } from 'vitest'; ${expression};`),
			[],
			expression,
		);
	for (const expression of [
		"expect(1)[`${name}not`]",
		"expect(1)[`not${name}`]",
	])
		assert.equal(
			pluginDiagnostics(
				`import { expect } from 'vitest'; ${expression};`,
			).filter((d) => d.message.startsWith("valid-expect:")).length,
			1,
			expression,
		);
});

test("static template accessors and interpolation expressions remain checked", () => {
	assert.equal(
		pluginDiagnostics(
			"import { expect } from 'vitest'; expect[`poll`](() => 1).toBe(1);",
		).filter((d) => d.message.startsWith("require-awaited-expect-poll:"))
			.length,
		1,
	);
	assert.deepEqual(
		pluginDiagnostics(
			"import { expect } from 'vitest'; await expect[`poll`](() => 1).toBe(1);",
		),
		[],
	);
	assert.equal(
		pluginDiagnostics(
			"import { expect } from 'vitest'; expect(`value ${expect(1)}`).toBe('value');",
		).filter((d) => d.message.startsWith("valid-expect:")).length,
		1,
	);
});
