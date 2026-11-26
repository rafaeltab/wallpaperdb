import {
	repositoryRoot,
	copyBuiltArtifacts,
} from "@wallpaperdb/coverage-runtime";
// A nested real Make build runs in the source checkout. Its resulting artifact
// must then be the artifact launched by the mirror's deployment contracts.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = repositoryRoot();
const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name))
	throw new Error("Select one existing workspace build");
const workspace = ["apps", "packages"]
	.map((group) => `${group}/${name}`)
	.find((w) => existsSync(resolve(root, w, "package.json")));
if (!workspace) throw new Error(`Unknown build workspace ${name}`);
const destination = resolve(root, ".coverage-runtime/build", workspace, "dist");
await copyBuiltArtifacts(resolve(root, workspace, "dist"), destination);
