import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

export type SandcastleConfig = {
  maxIterations: number;
  model: string;
  modelVariant: string;
  imageName: string;
  prBaseBranch: string | undefined;
  enableDockerCleanup: boolean;
  wallpaperdbConfigDir: string;
};

export function loadConfig(): SandcastleConfig {
  loadLocalEnv(".sandcastle/.env");
  loadGhTokenFromCli();

  return {
    maxIterations: Number(process.env.SANDCASTLE_MAX_ITERATIONS ?? "10"),
    model: process.env.SANDCASTLE_OPENCODE_MODEL ?? "openai/gpt-5.6-sol",
    modelVariant: process.env.SANDCASTLE_OPENCODE_VARIANT ?? "medium",
    imageName: process.env.SANDCASTLE_IMAGE_NAME ?? "wallpaperdb-sandcastle:opencode",
    prBaseBranch: process.env.SANDCASTLE_PR_BASE_BRANCH,
    enableDockerCleanup: process.env.SANDCASTLE_DOCKER_CLEANUP !== "false",
    wallpaperdbConfigDir: process.env.WALLPAPERDB_CONFIG_DIR ?? `${homedir()}/.config/wallpaperdb`,
  };
}

function loadLocalEnv(path: string): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function loadGhTokenFromCli(): void {
  if (process.env.GH_TOKEN) return;

  try {
    process.env.GH_TOKEN = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Leave GH_TOKEN unset so the failing gh command reports the auth problem.
  }
}
