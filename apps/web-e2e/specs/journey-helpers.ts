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

/** Arrange public catalogue pixels through the retained legacy pipeline. New
 * Wallpaper creation and Owner Source acceptance have their own upload journey. */
export async function arrangeLegacyCatalogueWallpaper(
  page: Page,
  picture: { name: string; mimeType: string; buffer: Buffer },
) {
  return page.evaluate(
    async ({ name, mimeType, base64 }) => {
      const clerk: unknown = Reflect.get(window, "Clerk");
      if (typeof clerk !== "object" || clerk === null || !("session" in clerk))
        throw new Error("Catalogue fixture requires the signed-in Owner");
      const session = clerk.session;
      if (
        typeof session !== "object" ||
        session === null ||
        !("getToken" in session) ||
        typeof session.getToken !== "function"
      )
        throw new Error("Catalogue fixture requires an active Owner session");
      const token: unknown = await session.getToken();
      if (typeof token !== "string" || !token)
        throw new Error("Catalogue fixture authentication is unavailable");
      const bytes = Uint8Array.from(atob(base64), (value) =>
        value.charCodeAt(0),
      );
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: mimeType }), name);
      const response = await fetch("/ingestor/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error(
          `Legacy catalogue fixture failed (HTTP ${response.status})`,
        );
      const receipt: unknown = await response.json();
      if (
        typeof receipt !== "object" ||
        receipt === null ||
        !("id" in receipt) ||
        typeof receipt.id !== "string" ||
        !receipt.id.startsWith("wlpr_")
      )
        throw new Error(
          "Legacy catalogue fixture returned no Wallpaper identity",
        );
      return receipt.id;
    },
    {
      name: picture.name,
      mimeType: picture.mimeType,
      base64: picture.buffer.toString("base64"),
    },
  );
}

export async function waitForWallpaper(page: Page, wallpaperId: string) {
  // Poll the public projection before opening the cached details query. This
  // waits for the real ingestion -> variants -> Asset -> Gateway delivery chain.
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

interface CatalogueQuery {
  query: string;
  variables: Record<string, unknown>;
}

/** Search pagination supports one color or the exact query captured from the UI. */
export async function waitForCataloguePage(
  page: Page,
  wallpaperId: string,
  search?: string | CatalogueQuery,
  profileId?: string,
) {
  const color = typeof search === "string" ? search : undefined;
  const catalogue =
    typeof search === "object"
      ? search
      : {
          query: `query BrowserCatalogue($after:String,$filter:WallpaperFilter,$sort:WallpaperSort) {
      searchWallpapers(filter:$filter,sort:$sort,first:20,after:$after) {
        edges { node { wallpaperId } } pageInfo { hasNextPage endCursor }
      }
    }`,
          variables: {
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
        };
  let matchingCursor: string | undefined;
  await expect
    .poll(
      async () => {
        let after: string | undefined;
        do {
          const response = await page.request.post("/gateway/graphql", {
            data: {
              query: catalogue.query,
              variables: { ...catalogue.variables, after: after ?? null },
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
        message:
          color || typeof search === "object"
            ? "the fresh upload participates in ranked catalogue results"
            : "the fresh upload reaches catalogue search",
        timeout: 60000,
      },
    )
    .toBe(true);
  return matchingCursor;
}
