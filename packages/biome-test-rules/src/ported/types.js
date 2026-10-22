// Adapted from @vitest/eslint-plugin 1.6.27, commit aad57d121647efe764463c37414a8cd67ec9cf92.
// MIT; see ../../UPSTREAM-LICENSE.txt. Biome supplies syntax/scope and diagnostics.
export const UtilName = {
	vi: "vi",
	vitest: "vitest",
};
export const DescribeAlias = {
	describe: "describe",
	fdescribe: "fdescribe",
	xdescribe: "xdescribe",
};
export const TestCaseName = {
	fit: "fit",
	it: "it",
	test: "test",
	xit: "xit",
	xtest: "xtest",
	bench: "bench",
};
export const HookName = {
	beforeAll: "beforeAll",
	beforeEach: "beforeEach",
	afterAll: "afterAll",
	afterEach: "afterEach",
	aroundEach: "aroundEach",
	aroundAll: "aroundAll",
};
export const ModifierName = {
	to: "to",
	have: "have",
	not: "not",
	rejects: "rejects",
	resolves: "resolves",
	returns: "returns",
	branded: "branded",
	asserts: "asserts",
	constructorParameters: "constructorParameters",
	parameters: "parameters",
	thisParameter: "thisParameter",
	guards: "guards",
	instance: "instance",
	items: "items",
};
export const EqualityMatcher = {
	toBe: "toBe",
	toEqual: "toEqual",
	toStrictEqual: "toStrictEqual",
};
