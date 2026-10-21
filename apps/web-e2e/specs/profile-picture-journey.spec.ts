import {
  expect,
  type Page,
  type Request,
  type Response,
  test,
} from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

import { fittingPicture } from "../fixtures/profile-fitting";

import { withDisposableOwner } from "../src/disposable-owner";

test.use({ actionTimeout: 15000, storageState: { cookies: [], origins: [] } });

type PictureFile = { name: string; mimeType: string; buffer: Buffer };

async function uploadPicture(
  page: Page,
  picture: PictureFile,
  outgoing: Buffer[],
  edit?: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>,
) {
  await page
    .getByRole("button", { name: "Edit profile picture", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Profile picture",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel("Choose picture", { exact: true }),
  ).toBeEnabled();
  await dialog
    .getByLabel("Choose picture", { exact: true })
    .setInputFiles(picture);
  await expect(
    dialog.getByRole("img", { name: "Selected avatar", exact: true }),
  ).toBeVisible();
  if (edit) await edit(dialog);
  let stopWatching = () => {};
  const saved = new Promise<Response>((resolve, reject) => {
    const onRequest = (request: Request) => {
      if (
        !request.url().endsWith("/user/profile/me/picture") ||
        request.method() !== "PUT"
      )
        return;
      stopWatching();
      // The HTTP deadline starts after local fitting dispatches the upload.
      void page
        .waitForResponse((response) => response.request() === request)
        .then(resolve, reject);
    };
    stopWatching = () => {
      page.off("request", onRequest);
    };
    page.on("request", onRequest);
  });
  try {
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    await expect(dialog).not.toBeVisible();
    const bytes = outgoing.at(-1);
    if (!bytes) throw new Error("Picture command had no observed File bytes");
    if (
      bytes.subarray(0, 4).toString() !== "RIFF" ||
      bytes.includes(Buffer.from("PRIVATE_CAMERA"))
    )
      throw new Error(
        "Picture command did not contain a private-metadata-free WebP",
      );
    expect(bytes.length).toBe(bytes.readUInt32LE(4) + 8);
    expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
    const chunks: string[] = [];
    for (let offset = 12; offset < bytes.length; ) {
      chunks.push(bytes.subarray(offset, offset + 4).toString());
      const size = bytes.readUInt32LE(offset + 4);
      offset += 8 + size + (size % 2);
    }
    expect(
      chunks.filter(
        (chunk) =>
          ![
            "VP8X",
            "ALPH",
            "VP8 ",
            "VP8L",
            ...(picture.mimeType === "image/gif" ? ["ANIM", "ANMF"] : []),
          ].includes(chunk),
      ),
    ).toEqual([]);
    return { profile: await response.json(), bytes };
  } finally {
    stopWatching();
  }
}

async function pixels(
  page: Page,
  bytes: Buffer,
  positions: [number, number][],
) {
  return page.evaluate(
    async ({ data, positions }) => {
      const encoded = await fetch(`data:image/webp;base64,${data}`);
      const bitmap = await createImageBitmap(await encoded.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { colorSpace: "srgb" });
      if (!context) throw new Error("Missing sRGB canvas");
      context.drawImage(bitmap, 0, 0);
      const result = {
        width: bitmap.width,
        height: bitmap.height,
        samples: positions.map(([x, y]) =>
          Array.from(context.getImageData(x, y, 1, 1).data),
        ),
        colorSpace: context.getContextAttributes().colorSpace,
      };
      bitmap.close();
      return result;
    },
    { data: bytes.toString("base64"), positions },
  );
}

async function animatedPixels(
  page: Page,
  bytes: Buffer,
  mimeType = "image/webp",
  positions: [number, number][] = [
    [128, 256],
    [384, 256],
  ],
) {
  return page.evaluate(
    async ({ data, mimeType, positions }) => {
      const Decoder = window.ImageDecoder;
      if (typeof Decoder !== "function")
        throw new Error("Native animation decoder unavailable");
      const encoded = await fetch(`data:${mimeType};base64,${data}`);
      const decoder = new Decoder({
        data: await encoded.arrayBuffer(),
        type: mimeType,
        preferAnimation: true,
      });
      try {
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        if (!track) throw new Error("Missing animated track");
        const frames = [];
        for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
          const { image } = await decoder.decode({
            frameIndex,
            completeFramesOnly: true,
          });
          try {
            const canvas = document.createElement("canvas");
            canvas.width = image.displayWidth;
            canvas.height = image.displayHeight;
            const context = canvas.getContext("2d", { colorSpace: "srgb" });
            if (!context) throw new Error("Missing sRGB canvas");
            context.drawImage(image, 0, 0);
            frames.push({
              width: image.displayWidth,
              height: image.displayHeight,
              timestamp: image.timestamp,
              duration: image.duration,
              samples: positions.map(([x, y]) =>
                Array.from(context.getImageData(x, y, 1, 1).data),
              ),
              colorSpace: context.getContextAttributes().colorSpace,
            });
            canvas.width = 0;
            canvas.height = 0;
          } finally {
            image.close();
          }
        }
        return {
          animated: track.animated,
          repetitions: track.repetitionCount,
          frames,
        };
      } finally {
        decoder.close();
      }
    },
    { data: bytes.toString("base64"), mimeType, positions },
  );
}

async function assertAnimation(page: Page, bytes: Buffer) {
  const decoded = await animatedPixels(page, bytes);
  expect(decoded).toMatchObject({ animated: true, repetitions: 2 });
  expect(
    decoded.frames.map((frame) => [frame.timestamp, frame.duration]),
  ).toEqual([
    [0, 100000],
    [100000, 200000],
    [300000, 300000],
    [600000, 400000],
  ]);
  for (const frame of decoded.frames)
    expect(frame).toMatchObject({
      width: 512,
      height: 512,
      colorSpace: "srgb",
    });
  const colors = [
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 255],
    [255, 255, 0],
  ];
  for (const [index, color] of colors.entries()) {
    for (let channel = 0; channel < 3; channel++)
      expect(
        Math.abs(decoded.frames[index].samples[0][channel] - color[channel]),
      ).toBeLessThan(15);
    expect(decoded.frames[index].samples[0][3]).toBe(255);
  }
  expect(decoded.frames[3].samples[1][3]).toBe(0);
}

async function frameGifCrop(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const zoom = dialog.getByRole("slider", { name: "Zoom", exact: true });
  await zoom.focus();
  await zoom.press("End");
  const crop = dialog.getByRole("group", { name: "Picture crop", exact: true });
  const box = await crop.boundingBox();
  if (!box) throw new Error("GIF crop was not measured");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 2.5, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
}

async function fixture(name: string, mimeType: string): Promise<PictureFile> {
  return {
    name,
    mimeType,
    buffer: await readFile(new URL(`../fixtures/${name}`, import.meta.url)),
  };
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
    name: "Reset",
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

function profilePictureImage(page: Page) {
  return profilePicture(page).locator("img");
}

test("Profile picture upload reaches public delivery and removal retires the old URL", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await withDisposableOwner(process.env, async ({ email, password }) => {
    const outgoing: Buffer[] = [];
    // Base64 avoids Playwright validating and tracing each byte as a separate value.
    await page.exposeFunction(
      "observePictureUpload",
      async (base64: string) => {
        const picture = Buffer.from(base64, "base64");
        outgoing.push(picture);
        await writeFile(
          test.info().outputPath(`processed-picture-${outgoing.length}.webp`),
          picture,
        );
      },
    );
    await page.addInitScript(() => {
      const send = window.fetch.bind(window);
      window.fetch = async (input, options) => {
        const url = input instanceof Request ? input.url : String(input);
        if (
          url.endsWith("/user/profile/me/picture") &&
          options?.method === "PUT" &&
          options.body instanceof FormData
        ) {
          const picture = options.body.get("picture");
          if (picture instanceof Blob) {
            const observe: (base64: string) => Promise<void> = Reflect.get(
              window,
              "observePictureUpload",
            );
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(picture);
            });
            await observe(dataUrl.slice(dataUrl.indexOf(",") + 1));
          }
        }
        return send(input, options);
      };
    });
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
    const journeyErrors: unknown[] = [];
    try {
      const publicPage = await publicContext.newPage();
      publicPage.on("pageerror", (error) => pageErrors.push(error.message));
      let uploads = 0;
      page.on("request", (request) => {
        if (
          request.url().endsWith("/user/profile/me/picture") &&
          request.method() === "PUT"
        )
          uploads++;
      });
      const policyResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/user/profile/me/picture-policy") &&
          response.request().method() === "GET",
      );
      const oriented = await fixture("profile-oriented.jpg", "image/jpeg");
      const first = await uploadPicture(page, oriented, outgoing);
      const effectivePolicyResponse = await policyResponse;
      expect(effectivePolicyResponse.ok()).toBe(true);
      const effectivePolicy = await effectivePolicyResponse.json();
      const orientedPixels = await pixels(page, first.bytes, [
        [64, 256],
        [448, 256],
        [0, 0],
        [511, 511],
      ]);
      expect(orientedPixels).toMatchObject({
        width: 512,
        height: 512,
        colorSpace: "srgb",
      });
      expect(orientedPixels.samples[0][2]).toBeGreaterThan(240);
      expect(orientedPixels.samples[0][0]).toBeLessThan(15);
      expect(orientedPixels.samples[1][0]).toBeGreaterThan(240);
      expect(orientedPixels.samples[1][2]).toBeLessThan(15);
      expect(
        orientedPixels.samples.slice(2).map((sample) => sample[3]),
      ).toEqual([255, 255]);
      const fitting = await fittingPicture();
      const fitted = await uploadPicture(page, fitting, outgoing);
      expect((await animatedPixels(page, fitted.bytes)).frames).toHaveLength(
        132,
      );
      expect(fitted.bytes.length).toBeLessThanOrEqual(
        effectivePolicy.maxOutputBytes,
      );
      expect(fitted.profile).toMatchObject({
        displayName: originalDisplayName,
        biographyMarkdown: originalBiography,
      });
      await expect(profilePictureImage(page)).toHaveAttribute("src", /.+/);
      const fittedUrl = await profilePictureImage(page).getAttribute("src");
      if (!fittedUrl)
        throw new Error("Accepted fitted picture has no public URL");
      const fittedDelivery = await publicContext.request.get(
        new URL(fittedUrl, page.url()).toString(),
      );
      expect(fittedDelivery.status()).toBe(200);
      expect(await fittedDelivery.body()).toEqual(fitted.bytes);
      const gif = await fixture("profile-disposal.gif", "image/gif");
      const last = await uploadPicture(page, gif, outgoing, async (dialog) => {
        await frameGifCrop(page, dialog);
      });
      await assertAnimation(page, last.bytes);
      expect(uploads).toBe(3);
      const saved = last.profile;
      expect(saved).toMatchObject({
        displayName: originalDisplayName,
        biographyMarkdown: originalBiography,
      });
      expect(saved.pictureAssetId).toEqual(expect.any(String));
      const image = profilePictureImage(page);
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
            await expect(profilePicture(publicPage)).toBeVisible();
            const src = await profilePictureImage(publicPage).evaluateAll(
              ([image]) => image?.getAttribute("src") ?? null,
            );
            return src ? new URL(src, publicPage.url()).toString() : null;
          },
          { timeout: 30000 },
        )
        .toBe(absolutePictureUrl);
      await expect
        .poll(() =>
          profilePictureImage(publicPage).evaluate((element) =>
            element instanceof HTMLImageElement ? element.naturalWidth : 0,
          ),
        )
        .toBeGreaterThan(0);

      const publicImage = await publicContext.request.get(absolutePictureUrl);
      expect(publicImage.status()).toBe(200);
      expect(publicImage.headers()["content-type"]).toMatch(/^image\//);
      expect(await publicImage.body()).toEqual(last.bytes);

      await assertAnimation(publicPage, await publicImage.body());
      const displayedColors = new Set<string>();
      await expect
        .poll(
          async () => {
            const displayed = profilePicture(publicPage);
            const box = await displayed.boundingBox();
            if (!box) return displayedColors.size;
            const screenshot = await displayed.screenshot({
              animations: "allow",
            });
            const sampled = await pixels(publicPage, screenshot, [
              [Math.floor(box.width / 4), Math.floor(box.height / 2)],
            ]);
            const [red, green, blue] = sampled.samples[0];
            if (red > 220 && green < 40 && blue < 40)
              displayedColors.add("red");
            if (green > 220 && red < 40 && blue < 40)
              displayedColors.add("green");
            if (red > 220 && green > 220 && blue > 220)
              displayedColors.add("white");
            if (red > 220 && green > 220 && blue < 40)
              displayedColors.add("yellow");
            return displayedColors.size;
          },
          {
            timeout: 8000,
            message:
              "the delivered Profile picture displays distinct animation frames",
          },
        )
        .toBeGreaterThanOrEqual(2);

      await removePicture(page);
      await expect.poll(() => profilePicture(page).textContent()).toMatch(/\S/);
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
            return profilePicture(publicPage).textContent();
          },
          { timeout: 30000 },
        )
        .toMatch(/\S/);
      expect(pageErrors).toEqual([]);
    } catch (cause) {
      journeyErrors.push(cause);
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
      } catch (cleanupError) {
        journeyErrors.push(cleanupError);
      }
      try {
        await publicContext.close();
      } catch (cleanupError) {
        journeyErrors.push(cleanupError);
      }
    }
    if (journeyErrors.length === 1) throw journeyErrors[0];
    if (journeyErrors.length > 1)
      throw new AggregateError(
        journeyErrors,
        "Profile picture journey and cleanup failed.",
      );
  });
});
