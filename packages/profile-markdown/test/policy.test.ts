import { describe, expect, it } from "vitest";
import { countProfileMarkdownCharacters, normalizeProfileLink, validateProfileMarkdown } from "../src/index.js";

describe("Profile Markdown policy", () => {
  it("normalizes external HTTPS destinations and exposes the actual hostname", () => {
    expect(normalizeProfileLink("HTTPS://BÜCHER.Example:443/a/../photo?q=1#view")).toEqual({
      href: "https://xn--bcher-kva.example/photo?q=1#view", hostname: "xn--bcher-kva.example"
    });
    expect(validateProfileMarkdown("[Gallery](https://example.com/photos)" )).toEqual({ valid: true, wallpaperIds: [] });
  });
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
