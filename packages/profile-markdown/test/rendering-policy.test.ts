import type { Root } from "hast";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import {
  ProfileMarkdownError,
  validateProfileMarkdown,
  profileMarkdownSanitizeSchema,
  remarkProfileMarkdown,
} from "../src/index.js";

function renderTree(source: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkProfileMarkdown)
    .use(remarkRehype)
    .use(rehypeSanitize, profileMarkdownSanitizeSchema);
  return processor.runSync(processor.parse(source), source);
}

describe("Profile Markdown rendering policy", () => {
  it("sanitizes the dedicated component attribute without admitting arbitrary data, handlers or image sources", () => {
    const unsafeTree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "span",
          properties: {
            dataWallpaperId: "wlpr_one",
            dataArbitrary: "injected",
            onClick: "alert(1)",
            src: "https://evil.example/image",
            style: "background:url(https://evil.example)",
          },
          children: [],
        },
        {
          type: "element",
          tagName: "span",
          properties: { dataWallpaperId: "../other" },
          children: [],
        },
        {
          type: "element",
          tagName: "img",
          properties: { src: "https://evil.example/image" },
          children: [],
        },
        {
          type: "element",
          tagName: "a",
          properties: { href: "javascript:alert(1)" },
          children: [],
        },
      ],
    };
    const tree = unified().use(rehypeSanitize, profileMarkdownSanitizeSchema).runSync(unsafeTree);
    expect(tree).toEqual({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "span",
          properties: { dataWallpaperId: "wlpr_one" },
          children: [],
        },
        { type: "element", tagName: "span", properties: {}, children: [] },
        { type: "element", tagName: "a", properties: {}, children: [] },
      ],
    });
  });

  it.each([
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    '<span data-wallpaper-id="wlpr_other">forged</span>',
    "<!-- hidden HTML -->",
    "![external](https://example.com/image.jpg)",
    "![data](data:image/png;base64,abc)",
    "![path](/media/wallpapers/one)",
    "![file](file:///etc/passwd)",
    "![custom](photo:one)",
    "![bad](wallpaper:)",
    "![bad](wallpaper:../one)",
    "![bad](wallpaper:one?x=1)",
    "![bad](wallpaper:one#x)",
    "![bad](wallpaper:one%2Ftwo)",
    "![bad](Wallpaper:one)",
    "![bad][external]\n\n[external]: https://example.com/image.jpg",
    "[bad][wall]\n\n[wall]: wallpaper:wlpr_one",
    "[bad](javascript&#58;alert(1))",
    "[bad](https://name:secret@example.com)",
    "[bad](<https://example.com/&#92;evil>)",
    "<javascript:alert(1)>",
    "Unsupported footnote[^one]\n\n[^one]: Footnote body",
  ])("rejects the same unsafe authored content on server and renderer: %s", (source) => {
    expect(validateProfileMarkdown(source).valid).toBe(false);
    expect(() => renderTree(source)).toThrow(ProfileMarkdownError);
  });

  it("keeps published content renderable beyond the default or a later lowered authoring limit", () => {
    const source = "😀".repeat(5001);
    expect(validateProfileMarkdown(source).valid).toBe(false);
    expect(validateProfileMarkdown(source, { maxCharacters: 5001 }).valid).toBe(true);
    expect(validateProfileMarkdown(source, { maxCharacters: null }).valid).toBe(true);
    expect(renderTree(source).children).toMatchObject([
      { type: "element", tagName: "p", children: [{ type: "text", value: source }] },
    ]);
  });

  it("normalizes inline, reference and GFM autolink destinations in the rendered tree", () => {
    const tree = renderTree(
      "[Inline](HTTPS://BÜCHER.Example:443/a/../photo) [Reference][ref] https://EXAMPLE.com\n\n[ref]: HTTPS://BÜCHER.Example:443/a/../photo"
    );
    expect(tree.children).toMatchObject([
      {
        type: "element",
        tagName: "p",
        children: [
          {
            type: "element",
            tagName: "a",
            properties: { href: "https://xn--bcher-kva.example/photo" },
          },
          { type: "text", value: " " },
          {
            type: "element",
            tagName: "a",
            properties: { href: "https://xn--bcher-kva.example/photo" },
          },
          { type: "text", value: " " },
          { type: "element", tagName: "a", properties: { href: "https://example.com/" } },
        ],
      },
    ]);
  });

  it("keeps escaped HTML and code examples as inert text", () => {
    const source =
      "\\<script>example\\</script> and `<img src=x onerror=alert(1)>`\n\n```html\n<script>example</script>\n```";
    expect(validateProfileMarkdown(source).valid).toBe(true);
    const tree = renderTree(source);
    expect(JSON.stringify(tree)).not.toContain('"tagName":"script"');
    expect(JSON.stringify(tree)).not.toContain('"tagName":"img"');
  });

  it("turns validated Wallpaper targets into narrow sanitized component properties", () => {
    const result = renderTree(
      "![A <script> stays text](wallpaper:wlpr_ABC) ![Other][wall]\n\n[wall]: wallpaper:legacy-photo_2"
    );
    expect(result.children).toMatchObject([
      {
        type: "element",
        tagName: "p",
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { dataWallpaperId: "wlpr_ABC" },
            children: [{ type: "text", value: "A <script> stays text" }],
          },
          { type: "text", value: " " },
          {
            type: "element",
            tagName: "span",
            properties: { dataWallpaperId: "legacy-photo_2" },
            children: [{ type: "text", value: "Other" }],
          },
        ],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('"src"');
    expect(JSON.stringify(result)).not.toContain('"tagName":"script"');
  });
});
