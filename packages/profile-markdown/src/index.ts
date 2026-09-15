import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface ProfileMarkdownIssue {
  code: "unsupported-syntax" | "too-long" | "invalid-link";
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

export interface ProfileMarkdownOptions {
  /** null validates syntax without imposing an authoring limit on published content. */
  maxCharacters?: number | null;
}

export function countProfileMarkdownCharacters(source: string): number {
  return Array.from(source).length;
}

export function validateProfileMarkdown(
  source: string,
  options: ProfileMarkdownOptions = {},
): ProfileMarkdownValidation {
  const maxCharacters = options.maxCharacters === undefined ? 5000 : options.maxCharacters;
  if (maxCharacters !== null && countProfileMarkdownCharacters(source) > maxCharacters) {
    return { valid: false, errors: [{ code: "too-long", message: `Biography must be ${maxCharacters} characters or fewer.` }] };
  }
  const errors: ProfileMarkdownIssue[] = [];
  for (const node of flatten(parser.parse(source))) {
    if ((node.type === "link" || node.type === "definition") && !normalizeProfileLink(node.url)) {
      errors.push({ code: "invalid-link", message: "Links must use absolute HTTPS URLs without credentials." });
    }
    if (!allowedNodes.has(node.type)) {
      errors.push({ code: "unsupported-syntax", message: "This Markdown syntax is not supported." });
    }
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true, wallpaperIds: [] };
}

export interface ProfileLinkDestination {
  href: string;
  hostname: string;
}

export function normalizeProfileLink(target: string): ProfileLinkDestination | null {
  if (!/^https:\/\//i.test(target)) return null;
  for (const character of target) {
    const code = character.charCodeAt(0);
    if (code <= 32 || (code >= 127 && code <= 159) || character === "\\") return null;
  }
  // Even empty credentials are misleading when displayed as an external destination.
  if (target.slice(8).split(/[/?#]/, 1)[0]?.includes("@")) return null;
  try {
    const url = new URL(target);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { href: url.href, hostname: url.hostname };
  } catch {
    return null;
  }
}
