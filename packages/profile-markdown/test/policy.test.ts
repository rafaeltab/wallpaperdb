import { describe, expect, it } from "vitest";
import { countProfileMarkdownCharacters, validateProfileMarkdown } from "../src/index.js";

describe("Profile Markdown policy", () => {
  it("counts Unicode code points and enforces the configurable authored-source limit", () => {
    expect(countProfileMarkdownCharacters("😀é" )).toBe(2);
    expect(validateProfileMarkdown("😀é", { maxCharacters: 2 })).toEqual({ valid: true, wallpaperIds: [] });
    expect(validateProfileMarkdown("😀éa", { maxCharacters: 2 })).toEqual({ valid: false, errors: [{ code: "too-long", message: "Biography must be 2 characters or fewer." }] });
    expect(validateProfileMarkdown("a".repeat(5001)).valid).toBe(false);
  });
  it("accepts authored CommonMark and GFM prose", () => {
    const source = "# About me\n\n**Photographer** and _explorer_. ~~Old~~ New.\n\n- [x] Publish wallpapers\n\n| Lens | Use |\n| --- | --- |\n| Wide | Landscapes |\n\n> Hello\n\n`<code>`";
    expect(validateProfileMarkdown(source)).toEqual({ valid: true, wallpaperIds: [] });
  });
});
