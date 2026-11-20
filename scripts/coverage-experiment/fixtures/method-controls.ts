import { Effect } from "../../../apps/user/node_modules/effect/dist/index.js";
export function callbacks() {
	const invoked = () => "invoked";
	const uncalled = () => "uncalled";
	return { result: invoked(), uncalled };
}
export function* consumed() {
	yield "yielded";
	return "returned";
}
export function* unstarted() {
	yield "never";
}
export const effect = Effect.gen(function* body() {
	yield* Effect.succeed("first");
	return "effect-result";
});
export const unrunEffect = Effect.gen(function* unrunBody() {
	yield* Effect.succeed("not-executed");
	return "never";
});
