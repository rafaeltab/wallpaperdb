import { expect, type Page, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

import { withDisposableOwner } from "../src/disposable-owner";

test.use({ actionTimeout: 15000, storageState: { cookies: [], origins: [] } });

type PictureFile = { name: string; mimeType: string; buffer: Buffer };

async function uploadPicture(
  page: Page,
  picture: PictureFile,
  outgoing: Buffer[],
  edit?: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>,
  route: "picker" | "drop" | "paste" = "picker",
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
    dialog.getByRole("button", { name: "Refresh Profile", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByLabel("Choose picture", { exact: true }),
  ).toBeEnabled();
  if (route === "picker") {
    await dialog
      .getByLabel("Choose picture", { exact: true })
      .setInputFiles(picture);
  } else {
    await dialog.evaluate(
      (element, { picture, route }) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array(picture.data)], picture.name, {
            type: picture.mimeType,
          }),
        );
        const event =
          route === "drop"
            ? new DragEvent("drop", {
                bubbles: true,
                cancelable: true,
                dataTransfer: transfer,
              })
            : new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: transfer,
              });
        element.dispatchEvent(event);
      },
      {
        picture: {
          name: picture.name,
          mimeType: picture.mimeType,
          data: Array.from(picture.buffer),
        },
        route,
      },
    );
  }
  await expect(
    dialog.getByRole("img", { name: "Selected avatar", exact: true }),
  ).toBeVisible();
  if (edit) await edit(dialog);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/user/profile/me/picture") &&
      response.request().method() === "PUT",
  );
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
}

async function pixels(
  page: Page,
  bytes: Buffer,
  positions: [number, number][],
) {
  return page.evaluate(
    async ({ data, positions }) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(data)], { type: "image/webp" }),
      );
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
    { data: Array.from(bytes), positions },
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
      const decoder = new Decoder({
        data: new Uint8Array(data),
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
    { data: Array.from(bytes), mimeType, positions },
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
  await expect(zoom).toHaveValue("2");
  const crop = dialog.getByRole("group", { name: "Picture crop", exact: true });
  const box = await crop.boundingBox();
  if (!box) throw new Error("GIF crop was not measured");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 2.5, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (
          await dialog
            .getByRole("img", { name: "Selected avatar", exact: true })
            .boundingBox()
        )?.x,
    )
    .toBeCloseTo(box.x, -1);
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
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(remove).toBeFocused();
  await expect(dialog).toBeVisible();
  await remove.click();
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
    const outgoing: Buffer[] = [];
    await page.exposeFunction(
      "observePictureUpload",
      async (bytes: number[]) => {
        const picture = Buffer.from(bytes);
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
            const observe: (bytes: number[]) => Promise<void> = Reflect.get(
              window,
              "observePictureUpload",
            );
            await observe(
              Array.from(new Uint8Array(await picture.arrayBuffer())),
            );
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
      let pictureWorkers = 0;
      page.on("worker", (worker) => {
        if (worker.url().includes("/picture-editor/")) pictureWorkers++;
      });
      page.on("request", (request) => {
        if (
          request.url().endsWith("/user/profile/me/picture") &&
          request.method() === "PUT"
        )
          uploads++;
      });
      const oriented = await fixture("profile-oriented.jpg", "image/jpeg");
      const first = await uploadPicture(
        page,
        oriented,
        outgoing,
        async (dialog) => {
          const zoom = dialog.getByRole("slider", {
            name: "Zoom",
            exact: true,
          });
          await zoom.focus();
          await zoom.press("ArrowRight");
          expect(Number(await zoom.inputValue())).toBeGreaterThan(1);
          await dialog
            .getByRole("button", { name: "Reset", exact: true })
            .click();
          await expect(zoom).toHaveValue("1");
          const crop = dialog.getByRole("group", {
            name: "Picture crop",
            exact: true,
          });
          await crop.hover();
          await page.mouse.wheel(0, -10000);
          await expect(zoom).toHaveValue("2");
          await page.mouse.wheel(0, 10000);
          await expect(zoom).toHaveValue("1");
          const touchBox = await crop.boundingBox();
          if (!touchBox) throw new Error("Pinch viewport was not measured");
          const touch = await page.context().newCDPSession(page);
          await touch.send("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 2,
          });
          const center = {
            x: touchBox.x + touchBox.width / 2,
            y: touchBox.y + touchBox.height / 2,
          };
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
              { id: 1, x: center.x - 20, y: center.y },
              { id: 2, x: center.x + 20, y: center.y },
            ],
          });
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
              { id: 1, x: center.x - 40, y: center.y },
              { id: 2, x: center.x + 40, y: center.y },
            ],
          });
          await expect(zoom).toHaveValue("2");
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await touch.send("Emulation.setTouchEmulationEnabled", {
            enabled: false,
          });
          await touch.detach();
          await dialog
            .getByRole("button", { name: "Reset", exact: true })
            .click();
          await expect(zoom).toHaveValue("1");
          const box = await crop.boundingBox();
          const image = dialog.getByRole("img", { name: "Selected avatar" });
          const before = await image.boundingBox();
          if (!box || !before) throw new Error("Crop preview was not measured");
          expect(before.width / box.width).toBeCloseTo(2, 1);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(
            box.x + box.width * 1.5,
            box.y + box.height / 2,
            {
              steps: 5,
            },
          );
          await page.mouse.up();
          const after = await image.boundingBox();
          expect(after?.x).toBeCloseTo(box.x, -1);
          await dialog
            .getByRole("button", { name: "Reset", exact: true })
            .click();
          // Cancel in the same browser turn before the asynchronous worker can return.
          await dialog.evaluate(async (element) => {
            const apply = Array.from(element.querySelectorAll("button")).find(
              (button) => button.textContent === "Apply",
            );
            if (!apply) throw new Error("Apply missing");
            apply.click();
            await Promise.resolve();
            const cancel = element.querySelector<HTMLButtonElement>(
              'button[aria-label="Cancel picture processing"]',
            );
            if (!cancel) throw new Error("Processing cancel button missing");
            cancel.click();
          });
          await expect(
            dialog.getByRole("button", { name: "Apply", exact: true }),
          ).toBeEnabled();
          expect(uploads).toBe(0);
        },
        "drop",
      );
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
      const transparent = await uploadPicture(
        page,
        await fixture("profile-transparent-p3.png", "image/png"),
        outgoing,
        undefined,
        "paste",
      );
      const transparentPixels = await pixels(page, transparent.bytes, [
        [256, 10],
        [256, 256],
      ]);
      expect(transparentPixels.samples[0][3]).toBe(0);
      expect(transparentPixels.samples[1][3]).toBe(128);
      for (const [index, expected] of [32, 180, 64].entries())
        expect(
          Math.abs(transparentPixels.samples[1][index] - expected),
        ).toBeLessThan(12);
      expect(pictureWorkers).toBeGreaterThanOrEqual(4);
      // Exercise the actual yielding browser adapter when worker support is absent.
      const nativeWorker = await page.evaluateHandle(() => window.Worker);
      await page.evaluate(() => {
        Object.defineProperty(window, "Worker", {
          value: undefined,
          configurable: true,
        });
      });
      const small = await uploadPicture(
        page,
        await fixture("profile-small.png", "image/png"),
        outgoing,
        async (dialog) => {
          await expect(
            dialog.getByRole("slider", { name: "Zoom" }),
          ).toBeDisabled();
          await expect(
            dialog.getByText(/smaller than 64 pixels/),
          ).toBeVisible();
          await expect(
            dialog.getByRole("button", { name: "Apply", exact: true }),
          ).toBeEnabled();
        },
      );
      const gif = await fixture("profile-disposal.gif", "image/gif");
      const originalAnimation = await animatedPixels(
        page,
        gif.buffer,
        gif.mimeType,
        [
          [16, 64],
          [48, 64],
        ],
      );
      expect(originalAnimation.repetitions).toBe(2);
      expect(originalAnimation.frames.map((frame) => frame.duration)).toEqual([
        100000, 200000, 300000, 400000,
      ]);
      expect(
        originalAnimation.frames.map((frame) => frame.samples[1][3]),
      ).toEqual([255, 255, 255, 0]);
      const fallbackAnimation = await uploadPicture(
        page,
        gif,
        outgoing,
        async (dialog) => {
          await frameGifCrop(page, dialog);
          const before = uploads;
          await dialog
            .getByRole("button", { name: "Apply", exact: true })
            .click();
          const cancel = dialog.getByRole("button", {
            name: "Cancel picture processing",
            exact: true,
          });
          await expect(cancel).toBeVisible();
          await cancel.click();
          await expect(
            dialog.getByRole("button", { name: "Apply", exact: true }),
          ).toBeEnabled();
          await expect(
            dialog.getByRole("slider", { name: "Zoom", exact: true }),
          ).toHaveValue("2");
          await expect(
            dialog.getByText("profile-disposal.gif", { exact: true }),
          ).toBeVisible();
          expect(uploads).toBe(before);
        },
        "paste",
      );
      await assertAnimation(page, fallbackAnimation.bytes);
      await page.evaluate((workerConstructor) => {
        Object.defineProperty(window, "Worker", {
          value: workerConstructor,
          configurable: true,
        });
      }, nativeWorker);
      await nativeWorker.dispose();
      const smallPixels = await pixels(page, small.bytes, [
        [0, 0],
        [511, 511],
      ]);
      expect(smallPixels).toMatchObject({ width: 512, height: 512 });
      expect(smallPixels.samples.map((sample) => sample[3])).toEqual([
        255, 255,
      ]);
      const workersBeforeGif = pictureWorkers;
      const last = await uploadPicture(page, gif, outgoing, (dialog) =>
        frameGifCrop(page, dialog),
      );
      expect(pictureWorkers - workersBeforeGif).toBeGreaterThanOrEqual(2);
      await assertAnimation(page, last.bytes);
      expect(uploads).toBe(5);
      const saved = last.profile;
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
