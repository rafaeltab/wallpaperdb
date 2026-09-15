import { describe, expect, it } from "vitest";
import { validateProfileMarkdown } from "../src/index.js";

describe("Profile Markdown policy", () => {
  it("accepts authored CommonMark and GFM prose", () => {
    const source = "# About me\n\n**Photographer** and _explorer_. ~~Old~~ New.\n\n- [x] Publish wallpapers\n\n| Lens | Use |\n| --- | --- |\n| Wide | Landscapes |\n\n> Hello\n\n`<code>`";
    expect(validateProfileMarkdown(source)).toEqual({ valid: true, wallpaperIds: [] });
  });
});
