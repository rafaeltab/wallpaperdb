import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const uploadFixturePaths = [
  fileURLToPath(new URL("../fixtures/fixture-a.png", import.meta.url)),
  fileURLToPath(new URL("../fixtures/fixture-b.jpg", import.meta.url)),
];

test("seeded base user can create and replace a Source through the browser UI", async ({
  page,
}) => {
  await page.goto("/web/upload");

  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
  await expect(page.getByTestId("upload-page")).toBeVisible();

  const creating = page.waitForResponse(
    (response) =>
      response.url().endsWith("/wallpaper/wallpapers") &&
      response.request().method() === "POST" &&
      response.status() === 202,
  );
  await page.getByTestId("file-input").setInputFiles(uploadFixturePaths[0]);
  const receipt: unknown = await (await creating).json();
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    !("wallpaperId" in receipt) ||
    typeof receipt.wallpaperId !== "string"
  )
    throw new Error("Missing durable Wallpaper receipt");
  const id = receipt.wallpaperId;

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

  const predecessor = download.suggestedFilename().replace(/\.png$/, "");
  const acceptingReplacement = page.waitForResponse(
    (response) =>
      response.url().endsWith("/accept") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.operation === "replace-one",
  );
  await creation
    .getByLabel(`Replace Source ${predecessor}`, { exact: true })
    .setInputFiles(uploadFixturePaths[1]);
  const replacementResponse = await acceptingReplacement;
  expect(replacementResponse.status()).toBe(200);
  const replacement: unknown = await replacementResponse.json();
  if (
    typeof replacement !== "object" ||
    replacement === null ||
    !("sourceId" in replacement) ||
    typeof replacement.sourceId !== "string"
  )
    throw new Error("Missing accepted replacement Source");
  expect(replacement.sourceId).not.toBe(predecessor);
  await expect(creation.getByTestId("source-upload-outcome")).toContainText(
    "Source accepted",
  );
  await page.reload();
  await expect(creation).toContainText("Wallpaper created");
  await expect(
    creation.getByLabel(`Replace Source ${predecessor}`, { exact: true }),
  ).toHaveCount(0);
  await expect(
    creation.getByLabel(`Replace Source ${replacement.sourceId}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(creation.getByTestId("wallpaper-sources")).toContainText(
    "1 accepted Sources. Source revision 2.",
  );
  const replacementDownloading = page.waitForEvent("download");
  await creation
    .getByRole("button", { name: "Download accepted Source", exact: true })
    .click();
  const replacedDownload = await replacementDownloading;
  const replacedPath = await replacedDownload.path();
  if (!replacedPath) throw new Error("Missing replacement original download");
  expect(replacedDownload.suggestedFilename()).toBe(
    `${replacement.sourceId}.jpg`,
  );
  expect(
    createHash("sha256")
      .update(await readFile(replacedPath))
      .digest("hex"),
  ).toBe(
    createHash("sha256")
      .update(await readFile(uploadFixturePaths[1]))
      .digest("hex"),
  );
});
