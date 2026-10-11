import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";
import { expect, it, vi } from "vitest";

import { waitForCataloguePage } from "../specs/journey-helpers";

it("finds a fresh upload beyond the first Profile and PNG page after color is cleared", async () => {
  const post = vi.fn(
    async (_url: string, options: { data: { variables: unknown } }) => {
      const { after } = options.data.variables as { after?: string };
      return {
        ok: () => true,
        json: async () => ({
          data: {
            searchWallpapers: after
              ? {
                  edges: [{ node: { wallpaperId: "wlpr_fresh" } }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                }
              : {
                  edges: [{ node: { wallpaperId: "wlpr_older" } }],
                  pageInfo: { hasNextPage: true, endCursor: "page-2" },
                },
          },
        }),
      };
    },
  );
  const page = { request: { post } } as unknown as Page;

  await expect(
    waitForCataloguePage(page, "wlpr_fresh", undefined, "profile_1"),
  ).resolves.toBe("page-2");
  expect(post).toHaveBeenCalledTimes(2);
  for (const [, options] of post.mock.calls) {
    expect(options.data.variables).toMatchObject({
      filter: { profileId: "profile_1", variants: { format: "image/png" } },
    });
    expect(options.data.variables).not.toHaveProperty("sort.color");
  }
});

it("finds the upload on a later page of the exact mixed query captured from Save", async () => {
  // Recorded public responses: 20 first-page results and three second-page results.
  // The signed end cursor is replaced by an opaque stable fixture cursor.
  const pages = JSON.parse(
    readFileSync(
      new URL("../fixtures/catalogue-mixed-pages.json", import.meta.url),
      "utf8",
    ),
  );
  const query = {
    query:
      "query SearchWallpapers($filter:WallpaperFilter,$sort:WallpaperSort,$first:Int,$after:String){searchWallpapers(filter:$filter,sort:$sort,first:$first,after:$after){edges{node{wallpaperId}}pageInfo{hasNextPage endCursor}}}",
    variables: {
      first: 20,
      after: null,
      filter: {
        profileId: "profile_fixture",
        variants: { format: "image/png" },
      },
      sort: {
        color: {
          targets: [
            { color: "#336699", mode: "VIBE", quality: "FAVORITE" },
            {
              name: "DARK",
              mode: "PROPORTIONS",
              quality: "STRICT",
              percent: 40,
            },
          ],
        },
      },
    },
  };
  const post = vi.fn(
    async (
      _url: string,
      options: { data: { variables: { after?: string | null } } },
    ) => ({
      ok: () => true,
      json: async () => ({
        data: {
          searchWallpapers: options.data.variables.after ? pages[1] : pages[0],
        },
      }),
    }),
  );
  const page = { request: { post } } as unknown as Page;
  await expect(
    waitForCataloguePage(page, "wlpr_01M4P8HSRY8ZD40A2M8F2P302S", query),
  ).resolves.toBe("mixed-page-2");
  expect(post).toHaveBeenCalledTimes(2);
  expect(post).toHaveBeenCalledWith("/gateway/graphql", { data: query });
  expect(post).toHaveBeenCalledWith("/gateway/graphql", {
    data: {
      ...query,
      variables: { ...query.variables, after: "mixed-page-2" },
    },
  });
});
