import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const uploadFixturePaths = [
  fileURLToPath(new URL("../fixtures/fixture-a.png", import.meta.url)),
  fileURLToPath(new URL("../fixtures/fixture-b.jpg", import.meta.url)),
];

test.use({ video: "on" });

test("owner can recover older work and replace a Source after more than 100 creations", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const uuidErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message.includes("randomUUID")) uuidErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("randomUUID"))
      uuidErrors.push(message.text());
  });
  // Establish the actual browser contract before mounting the upload screen.
  await page.goto("/web/");
  const context = await page.evaluate(() => ({
    origin: location.origin,
    secure: window.isSecureContext,
    randomUUID: typeof crypto.randomUUID,
    browser: navigator.userAgent,
  }));
  console.info("Upload UUID browser context", context);
  await testInfo.attach("browser-uuid-context", {
    body: JSON.stringify(context),
    contentType: "application/json",
  });
  if (testInfo.project.name === "chromium:http") {
    expect(context.origin).toContain("http://wallpaperdb-http.test:");
    expect(context.secure).toBe(false);
    expect(context.randomUUID).toBe("undefined");
  }
  await page.goto("/web/upload");

  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
  await expect(page.getByTestId("upload-page")).toBeVisible();
  expect(uuidErrors).toEqual([]);

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
  // Arrange older pending work and 100 newer durable creations through the
  // authenticated public API. All recovery and management uses the real UI.
  const pendingId = await page.evaluate(
    async (creationKeys) => {
      const clerk: unknown = Reflect.get(window, "Clerk");
      if (typeof clerk !== "object" || clerk === null || !("session" in clerk))
        throw new Error("Missing Owner");
      const session = clerk.session;
      if (
        typeof session !== "object" ||
        session === null ||
        !("getToken" in session) ||
        typeof session.getToken !== "function"
      )
        throw new Error("Missing session");
      let pending: string | undefined;
      for (const [i, key] of creationKeys.entries()) {
        const token: unknown = await session.getToken();
        if (typeof token !== "string") throw new Error("Missing token");
        const response = await fetch("/wallpaper/wallpapers", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: "{}",
          signal: AbortSignal.timeout(30000),
        });
        if (response.status !== 202)
          throw new Error(`Creation fixture HTTP ${response.status}`);
        const receipt: unknown = await response.json();
        if (
          typeof receipt !== "object" ||
          receipt === null ||
          !("wallpaperId" in receipt) ||
          typeof receipt.wallpaperId !== "string"
        )
          throw new Error("Missing Wallpaper receipt");
        if (i === 0) pending = receipt.wallpaperId;
      }
      if (!pending) throw new Error("Missing pending creation");
      return pending;
    },
    Array.from({ length: 101 }, () => randomUUID()),
  );
  await page.reload();
  await expect(
    page.getByTestId("wallpaper-creation").filter({ hasText: id }),
  ).toHaveCount(0);
  const openOlderWork = async () => {
    const older = page.getByRole("button", {
      name: "Older creations",
      exact: true,
    });
    await expect(older).toBeVisible();
    await older.click();
  };
  await openOlderWork();
  const pending = page
    .getByTestId("wallpaper-creation")
    .filter({ hasText: pendingId });
  await expect(pending).toContainText("Asset ready");
  await pending
    .getByLabel("Add Sources to this Wallpaper", { exact: true })
    .setInputFiles(uploadFixturePaths[0]);
  await expect(pending).toContainText("Wallpaper created", { timeout: 60000 });
  await page.reload();
  await openOlderWork();
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
  await openOlderWork();
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
  expect(uuidErrors).toEqual([]);
});
