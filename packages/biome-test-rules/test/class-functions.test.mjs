import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

const promiseDiagnostics = (source) =>
	lint(source).filter((d) => d.message.startsWith("valid-expect-in-promise:"));

test("class constructors and methods retain pinned function boundaries", () => {
	for (const member of ["constructor", "start"])
		assert.deepEqual(
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
			[],
			member,
		);
	assert.deepEqual(
		promiseDiagnostics(`
import { it, expect } from 'vitest';
it('case', async () => {
  const job = { start() {
    this.pending = Promise.resolve(1).then(value => expect(value).toBe(1));
  } };
  job.start();
  await job.pending;
});`),
		[],
	);
});

test("an unhandled promise directly inside a test still reports", () => {
	assert.equal(
		promiseDiagnostics(
			"import { it, expect } from 'vitest'; it('case', () => { Promise.resolve(1).then(value => expect(value).toBe(1)); });",
		).length,
		1,
	);
});
