import assert from "node:assert/strict";
import { record } from "./record.mjs";
const code = `export async function example(reuse,promise,test){const value=reuse?await promise:await promise;if(test){await 1;}}`;
const variant = process.argv.includes("--baseline")
	? "original-converter"
	: "converter";
const evidence = await record(
	"compact-false-regression",
	code,
	async (module) => {
		await module.example(true, Promise.resolve("ok"), false);
		return "completed";
	},
	variant,
);
const file = Object.values(evidence.result)[0];
const branches = Object.fromEntries(
	Object.entries(file.branchMap).map(([id, b]) => [b.type, file.b[id]]),
);
console.log({ variant, statements: file.s, branches, functions: file.f });
// The initializer and if execute once, its body never executes, function once.
assert.deepEqual(Object.values(file.s), [1, 1, 0]);
assert.deepEqual(Object.values(file.f), [1]);
assert.deepEqual(branches, { "cond-expr": [1, 0], if: [0, 1] });
