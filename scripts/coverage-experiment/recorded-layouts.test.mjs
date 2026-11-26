import assert from "node:assert/strict";
import { record } from "./record.mjs";
const kind = process.argv[2] || "else";
const programs = {
	else: `export async function example(reuse) {\n const value = reuse?await Promise.resolve('left'):await Promise.resolve('right');\n if (false) { await Promise.resolve(); } else { await Promise.resolve(); }\n}\n`,
	saturated: `export async function example(reuse) {\n const value = reuse?await Promise.resolve('left'):await Promise.resolve('right');\n if (value === 'right' || value === 'left') { await Promise.resolve(); }\n}\n`,
	abrupt: `export async function example(reuse,promise){\nconst value=reuse?await promise:await promise;\nconst check=(()=>{throw new Error('stopped');})();\nif (value === 'right' || value === 'left') { await Promise.resolve(); }\n\n}`,
};
const expected = {
	else: { branch: [0, 1], entry: 1 },
	saturated: { branch: [1, 0], entry: 1 },
	abrupt: { branch: [0, 0], entry: 0 },
}[kind];
const e = await record(
	"recorded-" + kind,
	programs[kind],
	async (m) => {
		await m
			.example(
				kind === "abrupt" ? false : true,
				Promise.resolve(kind === "abrupt" ? "right" : "left"),
			)
			.catch(() => {});
	},
	process.argv.includes("--baseline") ? "original-converter" : "converter",
);
const c = Object.values(e.result)[0];
const [id, b] = Object.entries(c.branchMap).find(([, b]) => b.type === "if");
assert.deepEqual(c.b[id], expected.branch);
const statement = Object.keys(c.statementMap).find(
	(id) =>
		c.statementMap[id].start.line === b.loc.start.line &&
		c.statementMap[id].start.column === b.loc.start.column,
);
assert.equal(c.s[statement], expected.entry, kind + " if evaluations");
console.log(kind, { branch: c.b[id], entry: c.s[statement] });
