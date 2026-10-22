// Adapted from @vitest/eslint-plugin 1.6.27, commit aad57d121647efe764463c37414a8cd67ec9cf92.
// MIT; see ../../UPSTREAM-LICENSE.txt. Biome supplies syntax/scope and diagnostics.
export const AST_NODE_TYPES = {
	ArrayExpression: "ArrayExpression",
	CallExpression: "CallExpression",
	MemberExpression: "MemberExpression",
	Property: "Property",
	FunctionExpression: "FunctionExpression",
	ReturnStatement: "ReturnStatement",
	ConditionalExpression: "ConditionalExpression",
	ArrowFunctionExpression: "ArrowFunctionExpression",
	AwaitExpression: "AwaitExpression",
	Literal: "Literal",
	TemplateLiteral: "TemplateLiteral",
	TaggedTemplateExpression: "TaggedTemplateExpression",
	ExpressionStatement: "ExpressionStatement",
	AssignmentExpression: "AssignmentExpression",
	BlockStatement: "BlockStatement",
	VariableDeclarator: "VariableDeclarator",
	Identifier: "Identifier",
	SequenceExpression: "SequenceExpression",
	ObjectPattern: "ObjectPattern",
	ImportExpression: "ImportExpression",
	TSImportEqualsDeclaration: "TSImportEqualsDeclaration",
	ImportSpecifier: "ImportSpecifier",
	SpreadElement: "SpreadElement",
	TSAsExpression: "TSAsExpression",
	TSTypeAssertion: "TSTypeAssertion",
};
export const createEslintRule = (rule) => rule;
export const joinNames = (a, b) => (a && b ? `${a}.${b}` : null);
export const isFunction = (node) =>
	node.type === AST_NODE_TYPES.FunctionExpression ||
	node.type === AST_NODE_TYPES.ArrowFunctionExpression;
export function getNodeName(node) {
	if (isSupportedAccessor(node)) return getAccessorValue(node);
	switch (node.type) {
		case AST_NODE_TYPES.TaggedTemplateExpression:
			return getNodeName(node.tag);
		case AST_NODE_TYPES.MemberExpression:
			return joinNames(getNodeName(node.object), getNodeName(node.property));
		case AST_NODE_TYPES.NewExpression:
		case AST_NODE_TYPES.CallExpression:
			return getNodeName(node.callee);
	}
	return null;
}
export const isSupportedAccessor = (node, value) => {
	return isIdentifier(node, value) || isStringNode(node, value);
};
/**
 * Checks if the given `node` is an `Identifier`.
 *
 * If a `name` is provided, & the `node` is an `Identifier`,
 * the `name` will be compared to that of the `identifier`.
 */
export const isIdentifier = (node, name) => {
	return (
		node.type === AST_NODE_TYPES.Identifier &&
		(name === undefined || node.name === name)
	);
};
/**
 * Checks if the given `node` is a `TemplateLiteral`.
 *
 * Complex `TemplateLiteral`s are not considered specific, and so will return `false`.
 *
 * If a `value` is provided & the `node` is a `TemplateLiteral`,
 * the `value` will be compared to that of the `TemplateLiteral`.
 */
const isTemplateLiteral = (node, value) => {
	return (
		node.type === AST_NODE_TYPES.TemplateLiteral &&
		node.quasis.length === 1 &&
		(value === undefined || node.quasis[0].value.raw === value)
	);
};
/**
 * Checks if the given `node` is a `StringLiteral`.
 *
 * If a `value` is provided & the `node` is a `StringLiteral`,
 * the `value` will be compared to that of the `StringLiteral`.
 */
const isStringLiteral = (node, value) =>
	node.type === AST_NODE_TYPES.Literal &&
	typeof node.value === "string" &&
	(value === undefined || node.value === value);
/**
 * Checks if the given `node` is a {@link StringNode}.
 */
export const isStringNode = (node, specifics) =>
	isStringLiteral(node, specifics) || isTemplateLiteral(node, specifics);
/**
 * Gets the value of the given `AccessorNode`,
 * account for the different node types.
 */
export const getAccessorValue = (accessor) =>
	accessor.type === AST_NODE_TYPES.Identifier
		? accessor.name
		: getStringValue(accessor);
/**
 * Gets the value of the given `StringNode`.
 *
 * If the `node` is a `TemplateLiteral`, the `raw` value is used;
 * otherwise, `value` is returned instead.
 */
export const getStringValue = (node) =>
	node?.type === AST_NODE_TYPES.TemplateLiteral
		? node.quasis[0].value.raw
		: node?.value;
