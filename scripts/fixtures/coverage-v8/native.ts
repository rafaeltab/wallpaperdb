export function nativeSelect(value: boolean): string {
	if (value) {
		return "native-executed";
	}
	return "native-never";
}
