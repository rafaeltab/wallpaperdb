import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface ProfileMarkdownIssue {
  code: "unsupported-syntax";
  message: string;
}

export type ProfileMarkdownValidation =
  | { valid: true; wallpaperIds: string[] }
  | { valid: false; errors: ProfileMarkdownIssue[] };

const parser = unified().use(remarkParse).use(remarkGfm);
const allowedNodes = new Set([
  "root", "paragraph", "text", "heading", "thematicBreak", "blockquote", "list", "listItem",
  "break", "code", "inlineCode", "emphasis", "strong", "delete", "table", "tableRow",
  "tableCell", "link", "image", "definition", "linkReference", "imageReference",
]);

function flatten(root: Root): Nodes[] {
  const nodes: Nodes[] = [];
  const pending: Nodes[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) break;
    nodes.push(node);
    if ("children" in node) pending.push(...[...node.children].reverse());
  }
  return nodes;
}

export function validateProfileMarkdown(source: string): ProfileMarkdownValidation {
  const errors: ProfileMarkdownIssue[] = [];
  for (const node of flatten(parser.parse(source))) {
    if (!allowedNodes.has(node.type)) {
      errors.push({ code: "unsupported-syntax", message: "This Markdown syntax is not supported." });
    }
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true, wallpaperIds: [] };
}
