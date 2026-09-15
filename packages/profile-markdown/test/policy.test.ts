import { describe, expect, it } from "vitest";
import { countProfileMarkdownCharacters, normalizeProfileLink, validateProfileMarkdown } from "../src/index.js";

describe("Profile Markdown policy", () => {
  it("collects unique Wallpaper IDs from inline and reference images for ownership validation", () => {
    const source = "![My photo](wallpaper:wlpr_ABC) ![Again](wallpaper:wlpr_ABC) ![Other][WALL]\n\n[wall]: wallpaper:legacy-photo_2";
    expect(validateProfileMarkdown(source)).toEqual({valid: true, wallpaperIds: ["wlpr_ABC", "legacy-photo_2"]});
  });
  it.each([
    "[x](javascript:alert(1))", "[x](JaVaScRiPt:alert(1))", "[x](javascript&#58;alert(1))",
    "[x](java&#x09;script:alert(1))", "[x](data:text/html;base64,abc)", "[x](mailto:a@example.com)",
    "[x](http://example.com)", "[x](//example.com)", "[x](/relative)", "[x](#anchor)",
    "[x](https://user:pass@example.com)", "[x](wallpaper:wlpr_one)", "[x](ftp://example.com)",
    "[x](https:example.com)", "[x](https://@example.com)", "[x](<https://example.com/a&#10;b>)",
    "[x](<https://example.com/&#92;evil>)", "<http://example.com>", "http://example.com",
    "person@example.com", "[x][bad]\n\n[bad]: javascript:alert(1)",
  ])("rejects unsafe or unsupported link targets: %s", (source) => {
    expect(validateProfileMarkdown(source).valid).toBe(false);
  });
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
