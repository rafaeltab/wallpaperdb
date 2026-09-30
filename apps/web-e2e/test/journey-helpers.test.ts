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
