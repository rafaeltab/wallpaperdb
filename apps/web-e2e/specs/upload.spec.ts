import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const uploadFixturePaths = [
  fileURLToPath(new URL("../fixtures/fixture-a.png", import.meta.url)),
  fileURLToPath(new URL("../fixtures/fixture-b.jpg", import.meta.url)),
];

test("seeded base user can upload committed fixtures through the browser UI", async ({
  page,
}) => {
  await page.goto("/web/upload");

  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
  await expect(page.getByTestId("upload-page")).toBeVisible();

  const creating = page
    .waitForResponse(
      (response) =>
        response.url().endsWith("/wallpaper/wallpapers") &&
        response.request().method() === "POST" &&
        response.status() === 202,
    )
    .then(async (response) => {
      const receipt: unknown = await response.json();
      if (
        typeof receipt !== "object" ||
        receipt === null ||
        !("wallpaperId" in receipt) ||
        typeof receipt.wallpaperId !== "string"
      )
        throw new Error("Missing durable Wallpaper receipt");
      return receipt.wallpaperId;
    });
  // The 202 starts an asynchronous workflow. Observe this creation's actual
  // publication before checking UI completion, and register before selecting
  // the file so an immediate publication cannot race the observer.
  const publishing = page.waitForResponse(async (response) => {
    const path = new URL(response.url()).pathname;
    if (
      response.request().method() !== "GET" ||
      response.status() !== 200 ||
      !path.startsWith("/wallpaper/wallpapers/")
    )
      return false;
    if (path !== `/wallpaper/wallpapers/${encodeURIComponent(await creating)}`)
      return false;
    const status: unknown = await response.json();
    return (
      typeof status === "object" &&
      status !== null &&
      "state" in status &&
      status.state === "published"
    );
  });
  const [id] = await Promise.all([
    creating,
    publishing,
    page.getByTestId("file-input").setInputFiles(uploadFixturePaths[0]),
  ]);

  await expect(page.getByTestId("upload-progress-status")).toHaveText(
    "Upload complete",
  );
  await expect(page.getByTestId("upload-progress-percent")).toHaveText("100%");
  await expect(page.getByTestId("upload-file-item")).toHaveCount(1);
  await expect(page.getByTestId("upload-failed-count")).toHaveCount(0);
  await expect(page.getByTestId("retry-failed-button")).toHaveCount(0);
  await page.reload();
  const creation = page
    .getByTestId("wallpaper-creation")
    .filter({ hasText: id });
  await expect(creation).toContainText("Wallpaper created");
  const downloading = page.waitForEvent("download");
  await creation
    .getByRole("button", { name: "Download accepted Source" })
    .click();
  const download = await downloading;
  const path = await download.path();
  if (!path) throw new Error("Missing original download");
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  ).toBe(
    createHash("sha256")
      .update(await readFile(uploadFixturePaths[0]))
      .digest("hex"),
  );
});
