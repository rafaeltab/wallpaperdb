import { expect, test } from "@playwright/test";

import {
  uniquePng,
  waitForCataloguePage,
  waitForWallpaper,
} from "./journey-helpers";

test.use({ actionTimeout: 15000 });

test("uploaded pixels survive catalogue delivery, filtering and accessible details", async ({
  page,
}) => {
  test.setTimeout(120000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/web/upload");
  await expect(page.getByTestId("upload-page")).toBeVisible();
  const picture = await uniquePng(page);
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/ingestor/upload") &&
      response.request().method() === "POST",
  );
  // A duplicate in the same queue keeps its notification available until the
  // user dismisses it, without racing the successful-only auto-dismiss timer.
  await page
    .getByTestId("file-input")
    .setInputFiles([
      picture,
      { ...picture, name: `duplicate-${picture.name}` },
    ]);
  const uploaded = await uploadResponse;
  expect(uploaded.ok()).toBe(true);
  const receipt = await uploaded.json();
  expect(receipt.id).toMatch(/^wlpr_/);
  const wallpaperId = String(receipt.id);
  await test.info().attach("uploaded-wallpaper", {
    body: wallpaperId,
    contentType: "text/plain",
  });
  await expect(page.getByTestId("upload-progress-status")).toHaveText(
    "Upload complete",
  );
  await expect(page.getByTestId("upload-file-item")).toHaveCount(2);
  await expect(page.getByTestId("upload-duplicate-count")).toContainText("1");

  await page
    .getByRole("banner")
    .getByRole("link", { name: "WallpaperDB", exact: true })
    .click();
  await expect(page).not.toHaveURL(/\/upload$/);
  const notification = page.getByTestId("upload-queue-toast");
  await expect(notification).toBeVisible();
  await notification.getByText("Upload complete", { exact: true }).click();
  await expect(page).toHaveURL(/\/web\/upload$/);
  await expect(page.getByTestId("upload-file-item")).toHaveCount(2);
  await expect(page.getByTestId("upload-file-list")).toContainText(
    picture.name,
  );
  await page.getByTestId("clear-completed-button").click();
  await expect(page.getByTestId("upload-file-item")).toHaveCount(0);

  await waitForWallpaper(page, wallpaperId);
  await page
    .getByRole("banner")
    .getByRole("link", { name: "WallpaperDB", exact: true })
    .click();
  const card = page.getByRole("button", {
    name: `Wallpaper ${wallpaperId}`,
    exact: true,
  });
  const catalogueCursor = await waitForCataloguePage(page, wallpaperId);
  await page.goto(
    `/web/${catalogueCursor ? `?after=${encodeURIComponent(catalogueCursor)}` : ""}`,
  );
  await expect(card).toBeVisible();
  await expect(card.getByRole("img")).toBeVisible();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("aria-expanded", "true");
  const detailsLink = page.getByRole("link", {
    name: "View details",
    exact: true,
  });
  await page.keyboard.press("Tab");
  await expect(detailsLink).toBeFocused();
  // Interactive actions must be siblings of the card button, never nested.
  expect(
    await detailsLink.evaluate((element) => element.closest("button")),
  ).toBeNull();
  await expect(
    page.getByRole("button", { name: "Download original", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).toBeVisible();
  const detailsOpened = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const details = await detailsOpened;
  details.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await expect(details).toHaveURL(new RegExp(`/wallpapers/${wallpaperId}$`));
    const panel = details.getByRole("dialog", {
      name: "Wallpaper Details",
      exact: true,
    });
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAccessibleDescription(/wallpaper/i);
    await panel
      .getByRole("button", { name: "Set 853×480 as display", exact: true })
      .click();
    await details.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    const displayed = details
      .getByTestId("wallpaper-container")
      .getByRole("img");
    await expect(displayed).toHaveAccessibleName("Wallpaper 853×480");
    await expect
      .poll(() =>
        displayed.evaluate((image: HTMLImageElement) => ({
          complete: image.complete,
          width: image.naturalWidth,
          height: image.naturalHeight,
        })),
      )
      .toEqual({ complete: true, width: 853, height: 480 });
    await details.keyboard.press("i");
    await expect(panel).toBeVisible();
  } finally {
    await details.close();
  }

  const colorCursor = await waitForCataloguePage(page, wallpaperId, "#336699");
  await page.getByRole("button", { name: /filter/i }).click();
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  const filtered = page.waitForResponse((response) => {
    if (
      !response.url().endsWith("/gateway/graphql") ||
      response.request().method() !== "POST"
    )
      return false;
    const request = response.request().postDataJSON();
    return (
      request.query.includes("SearchWallpapers") &&
      request.variables?.sort?.color
    );
  });
  await page.getByLabel("Color", { exact: true }).fill("#336699");
  const response = await filtered;
  expect(response.ok()).toBe(true);
  const results = await response.json();
  expect(results.errors).toBeUndefined();
  expect(results.data.searchWallpapers.edges.length).toBeGreaterThan(0);
  const first = results.data.searchWallpapers.edges[0].node;
  expect(
    first.variants.some(
      (variant: { format: string }) => variant.format === "image/png",
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", {
      name: `Wallpaper ${first.wallpaperId}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "PNG", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/color=%23336699/);
  if (colorCursor) {
    const selectedPage = new URL(page.url());
    selectedPage.searchParams.set("after", colorCursor);
    await page.goto(selectedPage.toString());
    await page
      .getByRole("button", { name: "Toggle filters", exact: true })
      .click();
  }
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Clear color", exact: true }).click();
  await expect(page).not.toHaveURL(/color=/);
  expect(pageErrors).toEqual([]);
});
