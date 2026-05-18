import { fileURLToPath } from "node:url";

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

  await page.getByTestId("file-input").setInputFiles(uploadFixturePaths);

  await expect(page.getByTestId("upload-progress-status")).toHaveText(
    "Upload complete",
  );
  await expect(page.getByTestId("upload-progress-percent")).toHaveText("100%");
  await expect(page.getByTestId("upload-file-item")).toHaveCount(2);
  await expect(page.getByTestId("upload-failed-count")).toHaveCount(0);
  await expect(page.getByTestId("retry-failed-button")).toHaveCount(0);
});
