import { expect, test } from "vitest";
import { lint } from "./lint.mjs";

const promiseDiagnostics = (source) =>
	lint(source).filter((d) => d.message.startsWith("valid-expect-in-promise:"));

test("class constructors and methods retain pinned function boundaries", () => {
	for (const member of ["constructor", "start"])
		expect(
			promiseDiagnostics(`
import { it, expect } from 'vitest';
it('case', async () => {
  class Job {
    ${member}() {
      this.pending = Promise.resolve(1).then(value => expect(value).toBe(1));
    }
  }
  const job = new Job();
  ${member === "start" ? "job.start();" : ""}
  await job.pending;
});`),
			member,
		).toStrictEqual([]);
	expect(
		promiseDiagnostics(`
import { it, expect } from 'vitest';
it('case', async () => {
  const job = { start() {
    this.pending = Promise.resolve(1).then(value => expect(value).toBe(1));
  } };
  job.start();
  await job.pending;
});`),
	).toStrictEqual([]);
});

test("an unhandled promise directly inside a test still reports", () => {
	expect(
		promiseDiagnostics(
			"import { it, expect } from 'vitest'; it('case', () => { Promise.resolve(1).then(value => expect(value).toBe(1)); });",
		).length,
	).toBe(1);
});

test("class accessors retain the same pinned function boundaries", () => {
	for (const member of [
		"get pending() { return this.work = Promise.resolve(1).then(value => expect(value).toBe(1)); }",
		"get pending() { this.work = Promise.resolve(1).then(value => expect(value).toBe(1)); return this.work; }",
		"set start(value) { this.work = Promise.resolve(1).then(value => expect(value).toBe(1)); }",
	])
		expect(
			promiseDiagnostics(`
import { it, expect } from 'vitest';
it('case', async () => {
  class Job { ${member} }
  const job = new Job();
  await job.pending;
  job.start = true;
  await job.work;
});`),
			member,
		).toStrictEqual([]);
});

test("class accessor decorators retain assertions outside the function boundary", () => {
	for (const member of ["get value() { return 1; }", "set value(value) {}"]) {
		const source = (assertion) =>
			`import { expect } from 'vitest'; class Example { @decorate(${assertion}) ${member} }`;
		expect(
			lint(source("expect(1)")).filter((d) =>
				d.message.startsWith("valid-expect:"),
			).length,
			member,
		).toBe(1);
		expect(lint(source("expect(1).toBe(1)")), member).toStrictEqual([]);
		expect(
			lint(
				`function expect(value) { return value; } class Example { @decorate(expect(1)) ${member} }`,
			),
			member,
		).toStrictEqual([]);
	}
});
