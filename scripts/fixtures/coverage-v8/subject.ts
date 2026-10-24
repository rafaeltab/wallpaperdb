export class Subject {
	constructor(readonly prefix: string) {}

	select(context: string) {
		if (context === "vite") {
			return this.prefix + "vite-only";
		}
		if (context === "child") {
			return this.prefix + "child-only";
		}
		if (context === "thread") {
			return this.prefix + "thread-only";
		}
		if (context === "never") {
			return this.prefix + "never-executed";
		}
		throw new Error("unsupported context");
	}
}
