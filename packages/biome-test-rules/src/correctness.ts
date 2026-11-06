import { ast, defineRule, registerDiagnostic } from "@biomejs/runtime/plugin";
import validExpectRule from "./ported/valid-expect.ts";
import validExpectInPromiseRule from "./ported/valid-expect-in-promise.ts";
import requireAwaitedExpectPollRule from "./ported/require-awaited-expect-poll.ts";
import retryRule from "./retry.ts";
import { port } from "./port.ts";

export const validExpect = port(validExpectRule, [
	{
		...validExpectRule.meta.defaultOptions[0],
		maxArgs: 2,
	},
]);
export const validExpectInPromise = port(validExpectInPromiseRule);
export const requireAwaitedExpectPoll = port(requireAwaitedExpectPollRule);
export const noTestRetries = port(retryRule);

export const fixedWait = defineRule({
	query: ast("JS_CALL_EXPRESSION"),
	run(node) {
		const callee = node.callee;
		if (
			callee?.kind === "JS_STATIC_MEMBER_EXPRESSION" &&
			callee.member?.text.trim() === "waitForTimeout"
		) {
			registerDiagnostic(
				node,
				"warning",
				"test-fixed-wait: await an observable condition; retain a fixed wait only when elapsed time is the behavior under test.",
			);
		}
	},
});
