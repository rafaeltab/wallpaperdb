import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

/** Unique pixels force a new immutable target on every run, including retries. */
export async function uniquePng(page: Page, width = 1280, height = 720) {
  const marker = randomUUID();
  const base64 = await page.evaluate(
    ({ width, height, marker }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const pixels = canvas.getContext("2d");
      if (!pixels) throw new Error("Canvas pixels are unavailable");
      pixels.fillStyle = "#336699";
      pixels.fillRect(0, 0, width, height);
      for (let index = 0; index < marker.length; index += 1) {
        pixels.fillStyle = `rgb(${marker.charCodeAt(index)},${index},0)`;
        pixels.fillRect(index, height - 1, 1, 1);
      }
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { width, height, marker },
  );
  return {
    name: `browser-contract-${marker}.png`,
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  };
}

export async function waitForWallpaper(page: Page, wallpaperId: string) {
  // Poll the public projection before opening the cached details query. This
  // waits for the real ingestion -> variants -> Media -> Gateway delivery chain.
  await expect
    .poll(
      async () => {
        const response = await page.request.post("/gateway/graphql", {
          data: {
            query:
              "query($id:ID!){getWallpaper(wallpaperId:$id){variants{width height}}}",
            variables: { id: wallpaperId },
          },
        });
        expect(response.ok()).toBe(true);
        const body = await response.json();
        expect(body.errors).toBeUndefined();
        return body.data.getWallpaper?.variants.length ?? 0;
      },
      {
        message:
          "original and both smaller variants reach the public catalogue",
        timeout: 60000,
      },
    )
    .toBe(3);
}

/** Search pagination keeps these checks independent of earlier uploaded data. */
export async function waitForCataloguePage(
  page: Page,
  wallpaperId: string,
  color?: string,
  profileId?: string,
) {
  let matchingCursor: string | undefined;
  await expect
    .poll(
      async () => {
        let after: string | undefined;
        do {
          const response = await page.request.post("/gateway/graphql", {
            data: {
              query: `query BrowserCatalogue($after:String,$filter:WallpaperFilter,$sort:WallpaperSort) {
            searchWallpapers(filter:$filter,sort:$sort,first:20,after:$after) {
              edges { node { wallpaperId } } pageInfo { hasNextPage endCursor }
            }
          }`,
              variables: {
                after,
                filter:
                  color || profileId
                    ? { profileId, variants: { format: "image/png" } }
                    : undefined,
                sort: color
                  ? {
                      color: {
                        mode: "VIBE",
                        quality: "FAVORITE",
                        targets: [{ color }],
                      },
                    }
                  : undefined,
              },
            },
          });
          expect(response.ok()).toBe(true);
          const body = await response.json();
          expect(body.errors).toBeUndefined();
          const results = body.data.searchWallpapers;
          if (
            results.edges.some(
              (edge: { node: { wallpaperId: string } }) =>
                edge.node.wallpaperId === wallpaperId,
            )
          ) {
            matchingCursor = after;
            return true;
          }
          after = results.pageInfo.hasNextPage
            ? results.pageInfo.endCursor
            : undefined;
        } while (after);
        return false;
      },
      {
        message: color
          ? "the fresh upload participates in colour-ranked catalogue results"
          : "the fresh upload reaches catalogue search",
        timeout: 60000,
      },
    )
    .toBe(true);
  return matchingCursor;
}
