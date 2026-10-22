import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

test("static strings and templates decode JavaScript name escapes without evaluating code", () => {
	for (const source of [
		String.raw`import { it } from 'vitest'; it('case', { ['retr\u0079']: 3 }, () => {});`,
		String.raw`import { it as scenario } from 'vitest'; scenario['sk\x69p']('case', () => {});`,
		String.raw`import { it as scenario } from 'vitest'; scenario['sk\u{69}p']('case', () => {});`,
		String.raw`import { it } from 'vi\u0074est'; it('case', { todo: true }, () => {});`,
		String.raw`import { test } from 'node:test'; test('case', { ['to\x64o']: true }, () => {});`,
		"import { it as scenario } from 'vitest'; scenario[`sk\\u0069p`]('case', () => {});",
	])
		assert.ok(
			lint(source).some((d) => d.severity === "error"),
			source,
		);
	for (const source of [
		String.raw`import { it as scenario } from 'vitest'; scenario['sk\\ip']('case', () => {});`,
		String.raw`import { it as scenario } from 'vitest'; scenario['\'skip\'']('case', () => {});`,
		String.raw`import { it as scenario } from 'vitest'; scenario['sk\"ip']('case', () => {});`,
		String.raw`import { it } from 'vitest'; it('case', { ['to\x64o']: false }, () => {});`,
		"import { it as scenario } from 'vitest'; scenario[tag`sk\\u0069p`]('case', () => {});",
	])
		assert.deepEqual(lint(source), [], source);
});

test("identifier tokens use the same static escape decoding as quoted names", () => {
	for (const source of [
		String.raw`import { it } from 'vitest'; it('case', { sk\u0069p: true }, () => {});`,
		String.raw`import { it } from 'vitest'; it('case', { retr\u0079: 3 }, () => {});`,
		String.raw`import { it as scenario } from 'vitest'; scenario.\u0073kip('case', () => {});`,
		String.raw`import { it } from 'vitest'; const { sk\u0069p: disabled } = it; disabled('case', () => {});`,
	])
		assert.ok(
			lint(source).some((d) => d.severity === "error"),
			source,
		);
	for (const source of [
		String.raw`import { it } from 'vitest'; it('case', { sk\u0069p: false }, () => {});`,
		String.raw`import { it } from 'vitest'; const skip = 'timeout'; it('case', { [skip]: true }, () => {});`,
		String.raw`import { it as scenario } from 'other-library'; scenario.\u0073kip('case', () => {});`,
	])
		assert.deepEqual(lint(source), [], source);
});
