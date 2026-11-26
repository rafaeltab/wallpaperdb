import assert from "node:assert/strict";
import { record } from "./record.mjs";
const variant = process.argv.includes("--baseline")
	? "original-converter"
	: "converter";
const evidence = await record(
	"generator-created-regression",
	`export function* example(){yield 'first';}`,
	(module) => {
		module.example();
		return "created without next";
	},
	variant,
);
const data = Object.values(evidence.result)[0];
console.log({
	variant,
	raw: evidence.coverage.functions,
	statements: data.s,
	functions: data.f,
});
// A generator call is a call, but its body starts only when next() is invoked.
assert.deepEqual(Object.values(data.f), [1]);
assert.deepEqual(Object.values(data.s), [0]);
