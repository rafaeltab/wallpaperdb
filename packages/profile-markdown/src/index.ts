import type { Definition, Nodes, Root } from "mdast";
import { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { type Plugin, unified } from "unified";

export interface ProfileMarkdownIssue {
  code: "unsupported-syntax" | "too-long" | "invalid-link" | "invalid-image";
  message: string;
}

export type ProfileMarkdownValidation =
  | { valid: true; wallpaperIds: string[] }
  | { valid: false; errors: ProfileMarkdownIssue[] };

const parser = unified().use(remarkParse).use(remarkGfm);
const allowedNodes = new Set([
  "root",
  "paragraph",
  "text",
  "heading",
  "thematicBreak",
  "blockquote",
  "list",
  "listItem",
  "break",
  "code",
  "inlineCode",
  "emphasis",
  "strong",
  "delete",
  "table",
  "tableRow",
  "tableCell",
  "link",
  "image",
  "definition",
  "linkReference",
  "imageReference",
]);

function flatten(root: Nodes): Nodes[] {
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
  options: ProfileMarkdownOptions = {}
): ProfileMarkdownValidation {
  const maxCharacters = options.maxCharacters === undefined ? 5000 : options.maxCharacters;
  if (maxCharacters !== null && countProfileMarkdownCharacters(source) > maxCharacters) {
    return {
      valid: false,
      errors: [
        { code: "too-long", message: `Biography must be ${maxCharacters} characters or fewer.` },
      ],
    };
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
      errors.push({
        code: "unsupported-syntax",
        message: "This Markdown syntax is not supported.",
      });
    }
    const definition =
      node.type === "linkReference" || node.type === "imageReference"
        ? definitions.get(node.identifier.toUpperCase())
        : undefined;
    const target = "url" in node ? node.url : definition?.url;
    if (
      (node.type === "link" || node.type === "linkReference") &&
      flatten(node).some((child) => child.type === "image" || child.type === "imageReference")
    ) {
      errors.push({
        code: "unsupported-syntax",
        message: "Wallpaper images cannot be used as link labels. Add a separate text link.",
      });
    }
    if (
      (node.type === "link" || node.type === "linkReference") &&
      (!target || !normalizeProfileLink(target))
    ) {
      errors.push({
        code: "invalid-link",
        message: "Links must use absolute HTTPS URLs without credentials.",
      });
    }
    if (
      node.type === "definition" &&
      !normalizeProfileLink(node.url) &&
      !wallpaperTarget(node.url)
    ) {
      errors.push({
        code: "invalid-link",
        message: "Links must use absolute HTTPS URLs without credentials.",
      });
    }
    if (node.type === "image" || node.type === "imageReference") {
      const id = target ? wallpaperTarget(target) : null;
      if (id) wallpaperIds.add(id);
      else
        errors.push({
          code: "invalid-image",
          message:
            "Images must reference your published wallpapers using wallpaper:<wallpaper-id>.",
        });
    }
  }
  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, wallpaperIds: [...wallpaperIds] };
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

export class ProfileMarkdownError extends Error {
  constructor(readonly issues: ProfileMarkdownIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "ProfileMarkdownError";
  }
}

/** Defense in depth after the shared remark policy; no arbitrary image source is admitted. */
export const profileMarkdownSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: defaultSchema.tagNames?.filter((name) => name !== "img"),
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), ["dataWallpaperId", wallpaperIdPattern]],
  },
  protocols: { ...defaultSchema.protocols, href: ["https"] },
};

/** Apply after remark-gfm. Public rendering validates syntax without an authoring length limit. */
export const remarkProfileMarkdown: Plugin<[], Root> = () => (tree) => {
  const result = validateTree(tree);
  if (!result.valid) throw new ProfileMarkdownError(result.errors);
  const nodes = flatten(tree);
  const definitions = definitionsIn(nodes);
  for (const node of nodes) {
    if (node.type === "link" || node.type === "definition") {
      const destination = normalizeProfileLink(node.url);
      if (destination) node.url = destination.href;
    }
    if (node.type === "image" || node.type === "imageReference") {
      const target =
        node.type === "image" ? node.url : definitions.get(node.identifier.toUpperCase())?.url;
      const id = target ? wallpaperTarget(target) : null;
      if (!id) continue; // validateTree has already rejected invalid image targets.
      node.data = {
        hName: "span",
        hProperties: { dataWallpaperId: id },
        hChildren: [{ type: "text", value: node.alt ?? "" }],
      };
    }
  }
};
