import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export const base = "5953aad5";
const git = (...args) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8" });
const file = (path, role) => ({
	path,
	role,
	text: git("show", `${base}:${path}`),
});
const textFile = (path, role, text) => ({ path, role, text });

export function prepare(destination) {
	const standards = [
		"docs/coding-standards/project-organization.md",
		"docs/coding-standards/frontend.md",
		"docs/coding-standards/application-and-domain.md",
		"docs/coding-standards/adapters.md",
	].map((p) => file(p, "standard"));
	const issues = [237, 174, 338, 170, 122].map((number) =>
		JSON.parse(
			execFileSync(
				"gh",
				[
					"issue",
					"view",
					String(number),
					"--repo",
					"rafaeltab/wallpaperdb",
					"--json",
					"number,title,body,comments,labels,url",
				],
				{ encoding: "utf8" },
			),
		),
	);
	const requirement = (issue) =>
		textFile(`issue-${issue.number}.md`, "requirement", issue.body);
	const real = (id, issue, paths, scope) => {
		const commit = git(
			"log",
			"-1",
			"--format=%H",
			base,
			"--",
			paths[0][0],
		).trim();
		return {
			id,
			scope,
			files: [
				requirement(issue),
				...paths.map(([p, r]) => file(p, r)),
				textFile(
					"selected-change.diff",
					"change",
					git(
						"show",
						commit,
						"--format=fuller",
						"--",
						...paths.map(([p]) => p),
					),
				),
			],
			changeCommit: commit,
		};
	};
	const cases = [
		real(
			"C01",
			issues[0],
			[
				["apps/web/test/features/profile-management.test.ts", "test"],
				...["index", "aliases", "pictures", "contract"].map((name) => [
					`apps/web/src/features/profile-management/${name}.ts`,
					"production",
				]),
			],
			"Review meaning and readability of this existing pure-policy suite and its selected last change. Issue 237 is related lifecycle context, not a claim that this suite owns all editor behavior. Missing-outcome claims must concern these exported pure policies, not other modules.",
		),
		real(
			"C02",
			issues[1],
			[
				["apps/gateway/test/cursor.service.unit.test.ts", "test"],
				["apps/gateway/src/cursors/index.ts", "production"],
				["apps/gateway/src/capabilities/catalogue/contract.ts", "production"],
				["apps/gateway/src/capabilities/catalogue/index.ts", "production"],
				["apps/gateway/test/helpers/catalogue.ts", "helper"],
			],
			"Review the signed cursor and controlled lifetime contract tests only. Issue 174 provides pagination context, not ownership of ranking/UI here. The wire envelope, HMAC, and expiry are adapter guarantees. Sharing a lifetime matrix between production and controlled adapters intentionally verifies port parity.",
		),
		real(
			"C03",
			issues[0],
			[
				["apps/web/test/features/feature-architecture.test.ts", "test"],
				["apps/web/test/features/feature-architecture.ts", "production"],
			],
			"Review the source-analysis tooling tests. Public feature imports, pure core dependencies, and cycles are the intended externally observable outputs of this analyzer. Source text fixtures and diagnostics are its public inputs/outputs. Issue 237 is related feature-interface context, not its original specification.",
		),
	];
	cases[0].files.push(requirement(issues[2]), requirement(issues[3]));
	cases[0].scope +=
		" Issues 338 and 170 supply the originating picture-selection and alias requirements. Other editor, backend and browser outcomes belong to their own suites.";
	cases[1].files.push(requirement(issues[4]));
	const productionCommit = git(
		"log",
		"-1",
		"--format=%H",
		base,
		"--",
		"apps/gateway/src/cursors/index.ts",
	).trim();
	cases[1].files.push(
		textFile(
			"production-change.diff",
			"change",
			git(
				"show",
				productionCommit,
				"--format=fuller",
				"--",
				"apps/gateway/src/cursors/index.ts",
			),
		),
	);
	const production = `export function poll(status, writing) { return !writing && ['pending', 'retrying'].includes(status) ? 5000 : false; }
export function mayWrite(loaded, previous, active) { return loaded && previous === active; }
export function save(value, port) { if (!value.trim()) return {tag:'Invalid'}; port.write(value.trim()); return {tag:'Saved'}; }
export class Editor { constructor() { this._draft = ''; } set(value) { this._draft = value; } get value() { return this._draft; } }
export function importError(source) { return source.includes('private') ? ['entry point'] : []; }
`;
	const header = `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport {poll, mayWrite, save, Editor, importError} from './subject.mjs';\n`;
	const seed = (id, requirementText, testText, extra = []) => ({
		id,
		scope:
			"This is the complete affected suite for the stated contract. Review test quality, not feature implementation. No other tests cover this contract.",
		files: [
			textFile("requirement.md", "requirement", requirementText),
			textFile("subject.mjs", "production", production),
			textFile("case.test.mjs", "test", header + testText),
			...extra,
		],
	});
	cases.push(
		seed(
			"C04",
			"Save trims nonblank values, calls the write port exactly once with that value, and returns Saved. This exact interaction is a contractual external effect. Blank input returns Invalid and never calls the port.",
			`test('save contract', () => {
  const calls=[]; const port={write:value=>calls.push(value)};
  assert.deepEqual(save(' x ',port), {tag:'Saved'}); assert.deepEqual(calls,['x']);
});
test('invalid is isolated from the port', () => { const calls=[]; assert.deepEqual(save(' ',{write:v=>calls.push(v)}),{tag:'Invalid'}); assert.deepEqual(calls,[]); });
`,
		),
		seed(
			"C05",
			"Save trims nonblank values, calls write exactly once, and returns Saved. Blank input returns Invalid and never calls write.",
			`test('save accepts', () => { const calls=[]; assert.deepEqual(save(' x ',{write:v=>calls.push(v)}),{tag:'Saved'}); assert.deepEqual(calls,['x']); });\n`,
		),
		seed(
			"C06",
			"Pending and retrying poll at 5000ms unless writing. All other states stop polling.",
			`test('pending interval', () => { const expected=poll('pending',false); assert.equal(poll('pending',false),expected); });
test('other polling rules', () => { assert.equal(poll('retrying',false),5000); for(const s of ['pending','retrying','complete',undefined]) assert.equal(poll(s,true),false); assert.equal(poll('complete',false),false); assert.equal(poll(undefined,false),false); });
`,
		),
		seed(
			"C07",
			"Editor.set updates the public value property. Private storage representation may change without breaking clients.",
			`test('draft updates', () => { const editor=new Editor(); editor.set('new'); assert.equal(editor._draft,'new'); });\n`,
		),
		seed(
			"C08",
			"Pending and retrying poll at 5000ms unless writing. All other states stop polling.",
			`import { check } from './helper.mjs';\ntest('polling policy', () => { for(const scenario of ['one','two','three','four','five','six']) check(scenario); });\n`,
			[
				textFile(
					"helper.mjs",
					"helper",
					`import assert from 'node:assert/strict';
import {poll} from './subject.mjs';
export function check(scenario) {
  const cases={one:['pending',false,5000],two:['retrying',false,5000],three:['complete',false,false],four:['pending',true,false],five:['retrying',true,false],six:[undefined,false,false]};
  const [status,writing,expected]=cases[scenario]; assert.equal(poll(status,writing),expected);
}
`,
				),
			],
		),
		seed(
			"C09",
			"Polling and session ownership are independent policies. Pending polls every 5000ms, writing pauses it. A loaded unchanged owner may write; unloaded or changed owners may not.",
			`test('polls and protects sessions', () => { assert.equal(poll('pending',false),5000); assert.equal(poll('pending',true),false); assert.equal(mayWrite(true,'a','a'),true); assert.equal(mayWrite(false,'a','a'),false); assert.equal(mayWrite(true,'a','b'),false); });\n`,
		),
		seed(
			"C10",
			"This source analyzer reports entry point when source contains a private dependency and accepts public dependencies. Source fixture syntax and diagnostics are the public contract.",
			`test('rejects private source', () => { assert.deepEqual(importError('import x from "private"'),['entry point']); });\ntest('accepts public source', () => { assert.deepEqual(importError('import x from "public"'),[]); });\n`,
		),
		seed(
			"C11",
			"The public poll policy is already covered by the complete narrow suite below. A higher-level identity wrapper adds no translation, synchronization or browser risk. Avoid repeating its complete policy matrix.",
			`const matrix=[['pending',false,5000],['retrying',false,5000],['pending',true,false],['retrying',true,false],['complete',false,false],[undefined,false,false]];
for(const [s,w,expected] of matrix) test('policy '+s+w,()=>assert.equal(poll(s,w),expected));
const screen={poll:(s,w)=>poll(s,w)};
for(const [s,w,expected] of matrix) test('screen '+s+w,()=>assert.equal(screen.poll(s,w),expected));
`,
		),
		seed(
			"C12",
			"Pending and retrying poll at 5000ms unless writing. All other states stop polling. Nesting and snapshot size are optional advisory observations only; no numerical limit is repository policy.",
			`import { describe } from 'node:test';
describe('poll',()=>describe('pending',()=>describe('idle',()=>describe('interval',()=>{ test('is fixed',()=>assert.equal(poll('pending',false),5000)); }))));
test('other polling rules', () => { assert.equal(poll('retrying',false),5000); for(const s of ['pending','retrying','complete',undefined]) assert.equal(poll(s,true),false); assert.equal(poll('complete',false),false); assert.equal(poll(undefined,false),false); });
`,
		),
	);
	cases.push({
		id: "C13",
		scope:
			"Complete opt-in snapshot case. Evaluate the optional size warning only when there is a concrete comprehension cost. This is an intentional externally observable fixed export contract.",
		files: [
			textFile(
				"requirement.md",
				"requirement",
				"The export contains all 55 ordered public identifiers, one per line, unchanged for compatibility. A snapshot intentionally freezes that entire export. Size alone is not a policy violation.",
			),
			textFile(
				"subject.mjs",
				"production",
				"export const exportIdentifiers = () => Array.from({length:55},(_,i)=>`public-${i}`).join('\\n')+'\\n';\n",
			),
			textFile(
				"case.test.mjs",
				"test",
				"import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport {readFileSync} from 'node:fs';\nimport {exportIdentifiers} from './subject.mjs';\ntest('freezes public export snapshot',()=>assert.equal(exportIdentifiers(),readFileSync(new URL('./export.snap',import.meta.url),'utf8')));\n",
			),
			textFile(
				"export.snap",
				"fixture",
				Array.from({ length: 55 }, (_, i) => `public-${i}`).join("\n") + "\n",
			),
		],
	});
	const packet = {
		prototype: "issue-420",
		baseline: git("rev-parse", base).trim(),
		capturedAt: new Date().toISOString(),
		issueContext: issues,
		standards,
		cases,
	};
	writeFileSync(destination, JSON.stringify(packet, null, 2) + "\n");
	return packet;
}

// Withheld from reviewer. Seed expectations measure detection, not human precision.
export const truth = [
	{ id: "C04", clean: true },
	{ id: "C05", expected: "missing-outcome" },
	{ id: "C06", expected: "self-derived" },
	{ id: "C07", expected: "private-detail" },
	{ id: "C08", expected: "hidden-helper" },
	{ id: "C09", expected: "mixed-scenarios" },
	{ id: "C10", clean: true },
	{ id: "C11", expected: "wide-matrix" },
	{ id: "C12", optional: "optional-nesting" },
	{ id: "C13", clean: true, optional: "optional-snapshot" },
];
