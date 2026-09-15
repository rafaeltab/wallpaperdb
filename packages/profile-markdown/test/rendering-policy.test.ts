import type { Root } from "hast";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { profileMarkdownSanitizeSchema, remarkProfileMarkdown } from "../src/index.js";

function renderTree(source: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkProfileMarkdown)
    .use(remarkRehype).use(rehypeSanitize, profileMarkdownSanitizeSchema);
  return processor.runSync(processor.parse(source), source);
}

describe("Profile Markdown rendering policy", () => {
  it("turns validated Wallpaper targets into narrow sanitized component properties", () => {
    const result = renderTree('![A <script> stays text](wallpaper:wlpr_ABC) ![Other][wall]\n\n[wall]: wallpaper:legacy-photo_2');
    expect(result.children).toMatchObject([{
      type: "element", tagName: "p", children: [
        { type: "element", tagName: "span", properties: {dataWallpaperId: "wlpr_ABC"}, children: [{type:"text", value:"A <script> stays text"}] },
        { type: "text", value: " " },
        { type: "element", tagName: "span", properties: {dataWallpaperId: "legacy-photo_2"}, children: [{type:"text", value:"Other"}] },
      ]
    }]);
    expect(JSON.stringify(result)).not.toContain('"src"');
    expect(JSON.stringify(result)).not.toContain('"tagName":"script"');
  });
});
