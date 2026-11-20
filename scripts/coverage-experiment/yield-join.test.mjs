import assert from "node:assert/strict";
import { record } from "./record.mjs";
const code = `export function* example(reuse) {\n const outcome = reuse ? yield* value('ok') : yield* value('stop');\n if (outcome !== 'stop') yield 'recovered';\n return outcome;\n}\nfunction* value(result) { yield 'suspend'; return result; }\n`;
for (const [name, calls, expected] of [
	["left", [true], [1, 0]],
	["right", [false], [0, 1]],
	["split", [true, false], [1, 1]],
	["zero", [], [0, 0]],
]) {
	const e = await record(
		"yield-join-" + name,
		code,
		(m) => {
			for (const flag of calls) {
				const g = m.example(flag);
				while (!g.next().done) {}
			}
		},
		process.argv.includes("--baseline") ? "original-converter" : "converter",
	);
	const c = Object.values(e.result)[0];
	const id = Object.keys(c.branchMap).find(
		(id) => c.branchMap[id].type === "if",
	);
	assert.deepEqual(c.b[id], expected, name + " alternatives");
	const statement = Object.keys(c.statementMap).find(
		(id) =>
			c.statementMap[id].start.line === 3 &&
			c.statementMap[id].start.column === 1,
	);
	assert.equal(c.s[statement], calls.length, name + " condition evaluations");
	assert.deepEqual(
		Object.values(c.f),
		[calls.length, calls.length],
		name + " functions",
	);
}
// Delegation that throws must not manufacture an incoming continuation.
{
	const abrupt = code.replace(
		"yield 'suspend'; return result;",
		"yield 'suspend'; throw new Error('stopped');",
	);
	const e = await record(
		"yield-join-abrupt",
		abrupt,
		(m) => {
			const g = m.example(true);
			g.next();
			assert.throws(() => g.next(), /stopped/);
		},
		process.argv.includes("--baseline") ? "original-converter" : "converter",
	);
	const c = Object.values(e.result)[0];
	const id = Object.keys(c.branchMap).find(
		(id) => c.branchMap[id].type === "if",
	);
	assert.deepEqual(
		c.b[id],
		[0, 0],
		"abrupt completion never evaluates condition",
	);
	const statement = Object.keys(c.statementMap).find(
		(id) =>
			c.statementMap[id].start.line === 3 &&
			c.statementMap[id].start.column === 1,
	);
	assert.equal(c.s[statement], 0, "abrupt completion does not execute if");
}
