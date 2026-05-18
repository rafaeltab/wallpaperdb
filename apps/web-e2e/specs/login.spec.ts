import { expect, test } from "@playwright/test";

import { resolveAuthCredentials } from "../src/auth-state";

test.use({
  storageState: {
    cookies: [],
    origins: [],
  },
});

test("seeded base user can sign in through the web UI", async ({ page }) => {
  const { email, password } = resolveAuthCredentials(process.env);

  await page.goto("/web");
  await page.getByTestId("user-menu-sign-in-link").click();

  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);

  await page.getByTestId("sign-in-email-input").fill(email);
  await page.getByTestId("sign-in-password-input").fill(password);
  await page.getByTestId("sign-in-submit-button").click();

  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
  await expect(page.getByTestId("user-menu-user-name")).toContainText(/\S+/);
});
