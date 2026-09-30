import { expect, type Page, test } from "@playwright/test";

import { withDisposableOwner } from "../src/disposable-owner";
import { uniquePng } from "./journey-helpers";

test.use({ actionTimeout: 15000, storageState: { cookies: [], origins: [] } });

type PictureFile = { name: string; mimeType: string; buffer: Buffer };

async function uploadPicture(page: Page, picture: PictureFile) {
  await page
    .getByRole("button", { name: "Edit profile picture", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Profile picture",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Choose picture", { exact: true })
    .setInputFiles(picture);
  await expect(
    dialog.getByRole("img", { name: "Selected avatar", exact: true }),
  ).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/user/profile/me/picture") &&
      response.request().method() === "PUT",
  );
  await dialog
    .getByRole("button", { name: /^(Upload|Replace) picture$/ })
    .click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  await expect(dialog).not.toBeVisible();
  return response.json();
}

async function removePicture(page: Page) {
  await page
    .getByRole("button", { name: "Edit profile picture", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Profile picture",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const remove = dialog.getByRole("button", {
    name: "Remove picture",
    exact: true,
  });
  if (!(await remove.count())) {
    await page.keyboard.press("Escape");
    return;
  }
  await remove.click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Use a generated avatar?",
    exact: true,
  });
  const removed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/user/profile/me/picture") &&
      response.request().method() === "DELETE",
  );
  await confirmation
    .getByRole("button", { name: "Use generated avatar", exact: true })
    .click();
  const response = await removed;
  expect(response.ok()).toBe(true);
  await expect(dialog).not.toBeVisible();
  expect((await response.json()).pictureAssetId).toBeNull();
}

function profilePicture(page: Page) {
  return page
    .getByRole("main")
    .last()
    .getByRole("img", { name: /'s profile picture$/ })
    .first();
}

test("Profile picture upload reaches public delivery and removal retires the old URL", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await withDisposableOwner(process.env, async ({ email, password }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/web/sign-in");
    await page.getByTestId("sign-in-email-input").fill(email);
    await page.getByTestId("sign-in-password-input").fill(password);
    await page.getByTestId("sign-in-submit-button").click();
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);

    await page.goto("/web/settings/profile");
    await expect(
      page.getByRole("button", { name: "Edit profile picture", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit display name", exact: true })
      .click();
    const displayName = page.getByRole("textbox", {
      name: "Display name",
      exact: true,
    });
    const originalDisplayName = await displayName.inputValue();
    await displayName.press("Escape");
    await page
      .getByRole("button", { name: "Edit biography", exact: true })
      .click();
    const biography = page.getByRole("textbox", {
      name: "Biography Markdown",
      exact: true,
    });
    const originalBiography = await biography.inputValue();
    await biography.press("Escape");
    const publicContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    try {
      const publicPage = await publicContext.newPage();
      publicPage.on("pageerror", (error) => pageErrors.push(error.message));
      const picture = await uniquePng(page, 128, 128);
      const saved = await uploadPicture(page, picture);
      expect(saved).toMatchObject({
        displayName: originalDisplayName,
        biographyMarkdown: originalBiography,
      });
      expect(saved.pictureAssetId).toEqual(expect.any(String));
      const image = profilePicture(page);
      await expect
        .poll(
          () =>
            image.evaluate((element) =>
              element instanceof HTMLImageElement ? element.naturalWidth : 0,
            ),
          { timeout: 30000 },
        )
        .toBeGreaterThan(0);
      const pictureUrl = await image.getAttribute("src");
      if (!pictureUrl)
        throw new Error("Saved Profile picture has no public URL");

      await page
        .getByRole("button", { name: "View profile", exact: true })
        .click();
      const preview = page.getByRole("dialog", {
        name: "Profile preview",
        exact: true,
      });
      const profileHref = await preview
        .getByRole("link", { name: "Open your profile" })
        .getAttribute("href");
      if (!profileHref) throw new Error("Profile preview has no public link");
      await page.keyboard.press("Escape");
      const publicUrl = new URL(profileHref, page.url()).toString();
      const absolutePictureUrl = new URL(pictureUrl, page.url()).toString();
      await expect
        .poll(
          async () => {
            await publicPage.goto(publicUrl);
            const src = await profilePicture(publicPage).getAttribute("src");
            return src ? new URL(src, publicPage.url()).toString() : null;
          },
          { timeout: 30000 },
        )
        .toBe(absolutePictureUrl);
      await expect
        .poll(() =>
          profilePicture(publicPage).evaluate((element) =>
            element instanceof HTMLImageElement ? element.naturalWidth : 0,
          ),
        )
        .toBeGreaterThan(0);

      const publicImage = await publicContext.request.get(absolutePictureUrl);
      expect(publicImage.status()).toBe(200);
      expect(publicImage.headers()["content-type"]).toMatch(/^image\//);

      await removePicture(page);
      await expect
        .poll(() => profilePicture(page).evaluate((element) => element.tagName))
        .toBe("DIV");
      await expect
        .poll(
          async () => {
            return publicPage.evaluate(async (url) => {
              const retired = await fetch(url, { cache: "no-store" });
              return {
                status: retired.status,
                cache: retired.headers.get("cache-control"),
              };
            }, absolutePictureUrl);
          },
          {
            message:
              "retired pictures cannot be fetched by an anonymous client",
            timeout: 30000,
          },
        )
        .toEqual({ status: 404, cache: "no-store" });
      await expect
        .poll(
          async () => {
            await publicPage.goto(publicUrl);
            return profilePicture(publicPage).evaluate(
              (element) => element.tagName,
            );
          },
          { timeout: 30000 },
        )
        .toBe("DIV");
      expect(pageErrors).toEqual([]);
    } finally {
      test.setTimeout(test.info().timeout + 30000);
      try {
        await page.goto("/web/settings/profile");
        await expect(
          page.getByRole("button", {
            name: "Edit profile picture",
            exact: true,
          }),
        ).toBeVisible();
        await removePicture(page);
      } finally {
        await publicContext.close();
      }
    }
  });
});
