import assert from "node:assert/strict";
import { record } from "./record.mjs";
const code = `export async function example(reuse) {
 const candidate = reuse ? await Promise.resolve('left') : await Promise.resolve('right');
 const receipt = {};
 receipt.candidate = candidate;
 const currentReceipt = receipt;
 const deferred = async () => currentReceipt.candidate;
 if (candidate === 'right' || candidate === 'left') { await Promise.resolve(); }
}
`;
const e = await record(
	"production-shape",
	code,
	async (m) => m.example(true),
	process.argv.includes("--baseline") ? "original-converter" : "converter",
);
const f = Object.values(e.result)[0];
const branches = Object.fromEntries(
	Object.entries(f.branchMap).map(([id, b]) => [b.type, f.b[id]]),
);
console.log({ s: f.s, f: f.f, branches });
assert.deepEqual(branches.if, [1, 0]);
assert.deepEqual(branches["binary-expr"], [1, 1]);
const statement = Object.entries(f.statementMap).find(
	([, loc]) => loc.start.line === 7 && loc.start.column === 1,
);
assert.equal(f.s[statement[0]], 1);
assert.deepEqual(Object.values(f.f), [1, 0]);
