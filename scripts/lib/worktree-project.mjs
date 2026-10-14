/** Derive a Docker-safe Compose name from Git's administrative worktree name. */
export function getProjectName(worktreeName) {
	if (worktreeName === null) return "wallpaperdb";

	const prefix = "wallpaperdb-";
	const slug = worktreeName
		.replace(/\//g, "-")
		.replace(/[^a-zA-Z0-9-]/g, "")
		.toLowerCase()
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");

	return prefix + (slug || "worktree").slice(0, 63 - prefix.length);
}
