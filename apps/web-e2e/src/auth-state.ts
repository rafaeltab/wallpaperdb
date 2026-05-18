import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

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

export async function ensureAuthPersonaBypassesClientTrust(
  env: WebE2EEnv,
  persona: AuthPersonaConfig = BASE_USER_AUTH,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { email } = resolveAuthCredentials(env, persona);
  const clerkSecretKey = resolveClerkSecretKey(env);
  const usersResponse = await fetchImpl(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
    {
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
      },
    },
  );

  if (!usersResponse.ok) {
    throw new Error(
      formatAuthSetupFailure(
        persona,
        `Unable to query Clerk users (${usersResponse.status}): ${await usersResponse.text()}`,
      ),
    );
  }

  const users = (await usersResponse.json()) as Array<{
    id: string;
    email_addresses?: Array<{ email_address: string }>;
    bypass_client_trust?: boolean;
  }>;
  const user = users.find((candidate) =>
    candidate.email_addresses?.some((address) => address.email_address === email),
  );

  if (!user) {
    throw new Error(
      formatAuthSetupFailure(
        persona,
        `No Clerk user found for ${email}.`,
      ),
    );
  }

  if (user.bypass_client_trust) {
    return;
  }

  const patchResponse = await fetchImpl(`https://api.clerk.com/v1/users/${user.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${clerkSecretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bypass_client_trust: true }),
  });

  if (!patchResponse.ok) {
    throw new Error(
      formatAuthSetupFailure(
        persona,
        `Unable to enable Clerk client trust bypass (${patchResponse.status}): ${await patchResponse.text()}`,
      ),
    );
  }
}

function resolveClerkSecretKey(env: WebE2EEnv): string {
  const configuredSecret = env.CLERK_SECRET_KEY?.trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  const userEnvPath = fileURLToPath(new URL("../../user/.env", import.meta.url));
  const userEnv = loadEnv({ path: userEnvPath }).parsed;
  const userServiceSecret = userEnv?.CLERK_SECRET_KEY?.trim();

  if (userServiceSecret) {
    return userServiceSecret;
  }

  throw new Error(
    "Browser E2E auth setup requires CLERK_SECRET_KEY, but it was not found in the environment or apps/user/.env.",
  );
}
