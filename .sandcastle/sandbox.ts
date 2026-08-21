import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

import type { SandcastleConfig } from "./config.js";

export function createSandboxResources(config: SandcastleConfig) {
  const turboCacheHostPath = prepareTurboCacheDirectory();
  const env: Record<string, string> = {
    CI: "true",
    DOCKER_HOST: "unix:///var/run/docker.sock",
    TURBO_CACHE_DIR: "/home/agent/.cache/wallpaperdb-turbo",
  };
  if (process.env.GH_TOKEN) env.GH_TOKEN = process.env.GH_TOKEN;

  const sandboxProvider = docker({
    imageName: config.imageName,
    network: "host",
    env,
    groups: [getDockerGroupId()],
    mounts: [
      { hostPath: "/var/run/docker.sock", sandboxPath: "/var/run/docker.sock", readonly: false },
      {
        hostPath: turboCacheHostPath,
        sandboxPath: env.TURBO_CACHE_DIR,
        readonly: false,
      },
      {
        hostPath: "./.sandcastle/.opencode/auth.json",
        sandboxPath: "/home/agent/.local/share/opencode/auth.json",
        readonly: true,
      },
      {
        hostPath: config.wallpaperdbConfigDir,
        sandboxPath: "/home/agent/.config/wallpaperdb",
        readonly: true,
      },
    ],
  });

  const hooks = {
    sandbox: {
      onSandboxReady: [
        {
          command:
            "corepack enable && pnpm install --frozen-lockfile && node scripts/setup-worktree.mjs && docker version --format 'Docker server {{.Server.Version}}'",
          timeoutMs: 600_000,
        },
      ],
    },
  };

  return { sandboxProvider, hooks };
}

type TurboCacheDirectoryOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export function prepareTurboCacheDirectory(options: TurboCacheDirectoryOptions = {}): string {
  const { env = process.env, homeDir = homedir() } = options;
  const configuredCacheHome = env.XDG_CACHE_HOME;
  const cacheHome = configuredCacheHome && isAbsolute(configuredCacheHome)
    ? configuredCacheHome
    : join(homeDir, ".cache");
  const cacheDir = join(cacheHome, "wallpaperdb", "turbo");
  mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

function getDockerGroupId(): number {
  try {
    const entry = execFileSync("getent", ["group", "docker"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const gid = Number(entry.split(":")[2]);
    if (Number.isInteger(gid)) return gid;
  } catch {
    // Fall through to Docker's common static GID in the local image.
  }
  return 999;
}
