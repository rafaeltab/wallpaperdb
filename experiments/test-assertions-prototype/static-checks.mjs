import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";

// Deliberately narrow, syntax-only rules. These do not establish assertion meaning
// or follow helpers across files. Keep advisory until a wider corpus is reviewed.
const prototypeRules = {
	"no-obvious-tautology": {
		meta: {
			type: "problem",
			schema: [],
			messages: {
				tautology: "The assertion compares the same expression to itself.",
			},
		},
		create(context) {
			return {
				CallExpression(node) {
					const matcher = node.callee;
					if (
						matcher.type !== "MemberExpression" ||
						!["toBe", "toEqual", "toStrictEqual"].includes(
							matcher.property.name,
						)
					)
						return;
					const call = matcher.object;
					if (
						call.type !== "CallExpression" ||
						call.callee.name !== "expect" ||
						call.arguments.length !== 1 ||
						node.arguments.length !== 1
					)
						return;
					const actual = call.arguments[0];
					const expected = node.arguments[0];
					// Calls/getters/computed accesses can change between evaluations.
					if (
						!["Identifier", "Literal"].includes(actual.type) ||
						actual.type !== expected.type
					)
						return;
					if (
						context.sourceCode.getText(actual) ===
						context.sourceCode.getText(expected)
					)
						context.report({ node, messageId: "tautology" });
				},
			};
		},
	},
	"no-swallowed-assertion": {
		meta: {
			type: "problem",
			schema: [],
			messages: {
				swallowed:
					"This assertion can fail inside a catch that completes normally.",
			},
		},
		create(context) {
			return {
				CallExpression(node) {
					if (
						node.callee.type !== "Identifier" ||
						node.callee.name !== "expect"
					)
						return;
					for (let parent = node.parent; parent; parent = parent.parent) {
						if (
							parent.type === "TryStatement" &&
							parent.handler &&
							node.range[0] < parent.block.range[1]
						) {
							if (
								!parent.handler.body.body.some(
									(statement) => statement.type === "ThrowStatement",
								)
							)
								context.report({ node, messageId: "swallowed" });
							break;
						}
						if (
							parent.type === "CallExpression" &&
							parent.callee.type === "MemberExpression" &&
							parent.callee.property.name === "catch" &&
							parent.callee.object.range[0] <= node.range[0] &&
							node.range[1] <= parent.callee.object.range[1]
						) {
							const callback = parent.arguments[0];
							if (
								callback &&
								["ArrowFunctionExpression", "FunctionExpression"].includes(
									callback.type,
								) &&
								callback.body.type === "BlockStatement" &&
								!callback.body.body.some(
									(statement) => statement.type === "ThrowStatement",
								)
							)
								context.report({ node, messageId: "swallowed" });
							break;
						}
					}
				},
			};
		},
	},
};

export async function eslintChecks(files, { root, project }) {
	const start = performance.now();
	const engine = new ESLint({
		cwd: root,
		overrideConfigFile: true,
		overrideConfig: [
			{
				files: ["**/*.ts", "**/*.tsx"],
				languageOptions: {
					parser: tseslint.parser,
					parserOptions: {
						project,
						tsconfigRootDir: root,
						ecmaFeatures: { jsx: true },
					},
				},
				plugins: {
					vitest,
					"@typescript-eslint": tseslint.plugin,
					prototype: { rules: prototypeRules },
				},
				settings: { vitest: { typecheck: true } },
				rules: {
					"vitest/valid-expect": ["error", { maxArgs: 2 }],
					"vitest/valid-expect-in-promise": "error",
					"vitest/require-awaited-expect-poll": "error",
					"@typescript-eslint/no-floating-promises": [
						"error",
						{ ignoreVoid: false },
					],
					"vitest/no-conditional-expect": "warn",
					"prototype/no-obvious-tautology": "warn",
					"prototype/no-swallowed-assertion": "warn",
				},
			},
		],
	});
	const results = await engine.lintFiles(files);
	const diagnostics = results.flatMap((result) =>
		result.messages.map((message) => ({
			file: result.filePath,
			line: message.line,
			column: message.column,
			rule: message.ruleId,
			message: message.message,
			fatal: message.fatal ?? false,
		})),
	);
	return { ms: Math.round(performance.now() - start), diagnostics };
}
