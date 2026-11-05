import type { SemanticModel } from "@biomejs/runtime/plugin";
import type { NativeNode } from "./native-view.ts";

export interface Position {
	line: number;
	column: number;
}
export interface Location {
	start: Position;
	end: Position;
}

// The adapter builds these fields according to `type`. The pinned algorithms
// inspect that tag before reading fields belonging to an expression or statement.
export interface SyntaxNode {
	type: string;
	native: NativeNode;
	range: [number, number];
	loc: Location;
	parent?: SyntaxNode;
	children: SyntaxNode[];
	name: string;
	value: string | number | boolean | null | SyntaxNode;
	computed: boolean;
	async: boolean;
	operator?: string;
	quasis: { value: { raw: string } }[];
	arguments: SyntaxNode[];
	params: SyntaxNode[];
	properties: SyntaxNode[];
	elements: SyntaxNode[];
	expressions: SyntaxNode[];
	declarations: SyntaxNode[];
	decorators: SyntaxNode[];
	body: SyntaxNode | SyntaxNode[];
	callee: SyntaxNode;
	object: SyntaxNode;
	property: SyntaxNode;
	argument: SyntaxNode;
	expression: SyntaxNode;
	id: SyntaxNode;
	init: SyntaxNode;
	key: SyntaxNode;
	tag: SyntaxNode;
	left: SyntaxNode;
	right: SyntaxNode;
	test: SyntaxNode;
	consequent: SyntaxNode;
	alternate: SyntaxNode;
}

export type Visitor = Record<string, ((node: SyntaxNode) => void) | undefined>;
export interface Settings {
	vitest?: {
		typecheck?: boolean;
		vitestImports?: (string | RegExp)[];
		globalAliases?: Record<string, string[]>;
	};
}
export interface Fix {
	text: string;
}
export interface Fixer {
	insertTextBefore(node: SyntaxNode, text: string): Fix;
	replaceText(node: SyntaxNode, text: string): Fix;
}
export interface Report {
	node: SyntaxNode;
	messageId: string;
	data?: Record<string, string | number>;
	loc?: Location;
	fix?: (fixer: Fixer) => Fix[] | null;
}
export interface Context {
	model: Pick<SemanticModel, "scope" | "binding">;
	nodes: SyntaxNode[];
	settings: Settings;
	report(report: Report): void;
	sourceCode?: { getText(node: SyntaxNode): string };
}
export interface Options {
	minArgs?: number;
	maxArgs?: number;
	alwaysAwait?: boolean;
	asyncMatchers?: string[];
}
export interface AdaptedRule {
	name: string;
	meta: {
		messages: Record<string, string>;
		defaultOptions?: Options[];
		docs?: Record<string, unknown>;
		type?: string;
		schema?: unknown[];
		fixable?: string;
	};
	defaultOptions?: Options[];
	create(context: Context, options: Options[]): Visitor;
}
