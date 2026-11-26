export function childOnly(flag: boolean) {
	if (flag) return "child-hit";
	return "unexecuted-return";
}
export function neverCalled() {
	return "never";
}
