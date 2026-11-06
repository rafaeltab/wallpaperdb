import { expect, test } from "vitest";
import { lint } from "./lint.ts";

const pluginDiagnostics = (source: string) =>
	lint(source).filter((d) => d.category === "plugin");

test("interpolated template members retain empty boundary quasis", () => {
	for (const expression of [
		`expect[\`poll\${name}\`](() => 1).toBe(1)`,
		`expect[\`\${name}poll\`](() => 1).toBe(1)`,
		`expect(1)[\`\${name}toBe\`](1)`,
	])
		expect(
			pluginDiagnostics(`import { expect } from 'vitest'; ${expression};`),
			expression,
		).toStrictEqual([]);
	for (const expression of [
		`expect(1)[\`\${name}not\`]`,
		`expect(1)[\`not\${name}\`]`,
	])
		expect(
			pluginDiagnostics(
				`import { expect } from 'vitest'; ${expression};`,
			).filter((d) => d.message.startsWith("valid-expect:")).length,
			expression,
		).toBe(1);
});

test("static template accessors and interpolation expressions remain checked", () => {
	expect(
		pluginDiagnostics(
			"import { expect } from 'vitest'; expect[`poll`](() => 1).toBe(1);",
		).filter((d) => d.message.startsWith("require-awaited-expect-poll:"))
			.length,
	).toBe(1);
	expect(
		pluginDiagnostics(
			"import { expect } from 'vitest'; await expect[`poll`](() => 1).toBe(1);",
		),
	).toStrictEqual([]);
	expect(
		pluginDiagnostics(
			`import { expect } from 'vitest'; expect(\`value \${expect(1)}\`).toBe('value');`,
		).filter((d) => d.message.startsWith("valid-expect:")).length,
	).toBe(1);
});
