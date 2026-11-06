export function allStacksHealthy(tasks, stacks) {
	const remaining = new Set(tasks.map((task) => task.issue));
	if (
		remaining.size === 0 ||
		remaining.size !== tasks.length ||
		stacks.length !== tasks.length
	)
		return false;
	return stacks.every(
		(stack) => stack.healthy === true && remaining.delete(stack.issue),
	);
}
