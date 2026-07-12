import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export function cleanupDockerResources(branch: string, enabled: boolean): void {
  if (!enabled) {
    console.log("Docker cleanup disabled by SANDCASTLE_DOCKER_CLEANUP=false.");
    return;
  }

  const projectName = getDockerProjectName(branch);
  console.log(`\nCleaning Docker resources for ${projectName}`);

  for (const composeFile of ["infra/docker-compose.apps.yml", "infra/docker-compose.yml"]) {
    if (existsSync(composeFile)) {
      runDockerCommand(["compose", "-p", projectName, "-f", composeFile, "down", "--volumes", "--remove-orphans"]);
    }
  }

  removeResources(["ps", "-aq", "--filter", `name=${projectName}`], ["rm", "-f", "-v"]);
  removeResources(["network", "ls", "-q", "--filter", `name=${projectName}`], ["network", "rm"]);
  removeResources(["volume", "ls", "-q", "--filter", `name=${projectName}`], ["volume", "rm", "-f"]);
}

export function getDockerProjectName(branch: string): string {
  const prefix = "wallpaperdb-";
  const slug = branch
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase()
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return `${prefix}${(slug || "worktree").slice(0, 63 - prefix.length)}`;
}

function removeResources(listArgs: string[], removeArgs: string[]): void {
  const ids = listDockerResourceIds(listArgs);
  if (ids.length > 0) runDockerCommand([...removeArgs, ...ids]);
}

function runDockerCommand(args: string[]): void {
  try {
    execFileSync("docker", args, { stdio: "inherit" });
  } catch {
    console.warn(`Docker cleanup command failed: docker ${args.join(" ")}`);
  }
}

function listDockerResourceIds(args: string[]): string[] {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
