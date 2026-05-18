import { fileURLToPath } from "node:url";

type WebE2EEnv = NodeJS.ProcessEnv;

type AuthPersonaConfig = {
  name: string;
  emailEnvKey: string;
  passwordEnvKey: string;
  storageStatePath: string;
};

export const BASE_USER_AUTH = {
  name: "base-user",
  emailEnvKey: "E2E_BASE_TEST_EMAIL",
  passwordEnvKey: "E2E_BASE_TEST_PASSWORD",
  storageStatePath: fileURLToPath(
    new URL("../.auth/base-user.json", import.meta.url),
  ),
} as const satisfies AuthPersonaConfig;

export function resolveAuthCredentials(
  env: WebE2EEnv,
  persona: AuthPersonaConfig = BASE_USER_AUTH,
): { email: string; password: string } {
  const missingKeys = [persona.emailEnvKey, persona.passwordEnvKey].filter((key) => {
    const value = env[key]?.trim();
    return !value;
  });

  if (missingKeys.length > 0) {
    throw new Error(
      [
        `Browser E2E auth setup for ${persona.name} is missing required environment values.`,
        `Set ${missingKeys.join(" and ")} in apps/web-e2e/.env before running authenticated specs.`,
      ].join("\n"),
    );
  }

  return {
    email: env[persona.emailEnvKey]!.trim(),
    password: env[persona.passwordEnvKey]!.trim(),
  };
}

export function formatAuthSetupFailure(
  persona: AuthPersonaConfig,
  detail?: string,
): string {
  const trimmedDetail = detail?.trim();

  return [
    `Browser E2E auth setup failed for ${persona.name}.`,
    `Check ${persona.emailEnvKey} and ${persona.passwordEnvKey}.`,
    trimmedDetail ? `Auth response: ${trimmedDetail}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
