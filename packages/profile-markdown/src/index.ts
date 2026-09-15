import type { Definition, Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface ProfileMarkdownIssue {
  code: "unsupported-syntax" | "too-long" | "invalid-link" | "invalid-image";
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
  return validateTree(parser.parse(source));
}

const wallpaperIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

function wallpaperTarget(target: string): string | null {
  if (!target.startsWith("wallpaper:")) return null;
  const id = target.slice("wallpaper:".length);
  return wallpaperIdPattern.test(id) ? id : null;
}

function definitionsIn(nodes: Nodes[]): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  for (const node of nodes) {
    if (node.type === "definition" && !definitions.has(node.identifier.toUpperCase())) {
      definitions.set(node.identifier.toUpperCase(), node);
    }
  }
  return definitions;
}

function validateTree(root: Root): ProfileMarkdownValidation {
  const errors: ProfileMarkdownIssue[] = [];
  const wallpaperIds = new Set<string>();
  const nodes = flatten(root);
  const definitions = definitionsIn(nodes);
  for (const node of nodes) {
    if (!allowedNodes.has(node.type)) {
      errors.push({ code: "unsupported-syntax", message: "This Markdown syntax is not supported." });
    }
    const definition = node.type === "linkReference" || node.type === "imageReference"
      ? definitions.get(node.identifier.toUpperCase()) : undefined;
    const target = "url" in node ? node.url : definition?.url;
    if ((node.type === "link" || node.type === "linkReference") && (!target || !normalizeProfileLink(target))) {
      errors.push({ code: "invalid-link", message: "Links must use absolute HTTPS URLs without credentials." });
    }
    if (node.type === "definition" && !normalizeProfileLink(node.url) && !wallpaperTarget(node.url)) {
      errors.push({ code: "invalid-link", message: "Links must use absolute HTTPS URLs without credentials." });
    }
    if (node.type === "image" || node.type === "imageReference") {
      const id = target ? wallpaperTarget(target) : null;
      if (id) wallpaperIds.add(id);
      else errors.push({ code: "invalid-image", message: "Images must reference your published wallpapers using wallpaper:<wallpaper-id>." });
    }
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true, wallpaperIds: [...wallpaperIds] };
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
