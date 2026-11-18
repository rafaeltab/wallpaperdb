import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const fixture = fileURLToPath(
  new URL("../fixtures/fixture-a.png", import.meta.url),
);

test.use({ video: "on" });

test("owner can withdraw, add and replace after accepting sixteen Sources without reloading", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/web/upload");
  const sources = page.getByRole("region", {
    name: "Create one Wallpaper with multiple Sources",
    exact: true,
  });
  const bytes = await readFile(fixture);
  await sources
    .getByLabel("Choose initial Sources for one Wallpaper", { exact: true })
    .setInputFiles(
      Array.from({ length: 16 }, (_, index) => ({
        name: `source-${index}.png`,
        mimeType: "image/png",
        buffer: bytes,
      })),
    );
  await expect(sources).toContainText("16 accepted Sources.", {
    timeout: 120000,
  });
  await expect(sources.getByTestId("source-upload-outcome")).toHaveCount(16);
  await expect(
    sources
      .getByTestId("source-upload-outcome")
      .filter({ hasText: "Source accepted" }),
  ).toHaveCount(16);
  const withdrawals = sources.getByRole("button", {
    name: /^Withdraw Source /,
  });
  await withdrawals.and(page.locator(":enabled")).first().click();
  await expect(sources).toContainText("15 accepted Sources.");
  const intake = sources.getByLabel(
    "Choose initial Sources for one Wallpaper",
    { exact: true },
  );
  await expect(intake).toBeEnabled();
  await intake.setInputFiles(fixture);
  await expect(sources).toContainText("16 accepted Sources.");
  const replacement = sources.getByLabel(/^Replace Source /).first();
  await expect(replacement).toBeEnabled();
  await replacement.setInputFiles(fixture);
  await expect(
    sources
      .getByTestId("source-upload-outcome")
      .filter({ hasText: "Source accepted" }),
  ).toHaveCount(18, { timeout: 30000 });
  await expect(sources).toContainText(
    "16 accepted Sources. Source revision 19.",
  );
});
