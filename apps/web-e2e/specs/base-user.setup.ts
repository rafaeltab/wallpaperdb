import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test } from "@playwright/test";

import {
  BASE_USER_AUTH,
  formatAuthSetupFailure,
  resolveAuthCredentials,
} from "../src/auth-state";

test("authenticates the seeded base user and saves browser state", async ({
  page,
}) => {
  const { email, password } = resolveAuthCredentials(process.env);

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  const authError = page.getByRole("alert").first();

  try {
    await Promise.race([
      page.waitForURL((url) => !url.pathname.endsWith("/sign-in"), {
        timeout: 15000,
      }),
      authError.waitFor({ state: "visible", timeout: 15000 }).then(async () => {
        throw new Error(
          formatAuthSetupFailure(BASE_USER_AUTH, await authError.textContent()),
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Browser E2E auth setup failed")) {
      throw error;
    }

    throw new Error(
      formatAuthSetupFailure(
        BASE_USER_AUTH,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);

  mkdirSync(dirname(BASE_USER_AUTH.storageStatePath), { recursive: true });
  await page.context().storageState({ path: BASE_USER_AUTH.storageStatePath });
});
