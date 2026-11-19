// A nested real Make build runs in the source checkout. Its resulting artifact
// must then be the artifact launched by the mirror's deployment contracts.
import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name))
	throw new Error("Select one existing workspace build");
const workspace = ["apps", "packages"]
	.map((group) => `${group}/${name}`)
	.find((w) => existsSync(resolve(root, w, "package.json")));
if (!workspace) throw new Error("Unknown build workspace " + name);
const destination = resolve(root, ".coverage-runtime/build", workspace, "dist");
await rm(destination, { recursive: true, force: true });
await cp(resolve(root, workspace, "dist"), destination, { recursive: true });
