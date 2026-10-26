import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** "owner/repo" or "repo#N" for a github.com repository, issue or pull request URL. */
export function githubLabel(href: string): string | undefined {
  try {
    const url = new URL(href);
    if (
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.port ||
      !/^https?:$/.test(url.protocol)
    )
      return;
    const issue = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/([1-9]\d*)\/?$/);
    if (issue) return `${issue[2]}#${issue[3]}`;
    const repo = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/?$/);
    return repo ? `${repo[1]}/${repo[2]}` : undefined;
  } catch {
    return;
  }
}

export function isLinearLink(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.hostname === "linear.app" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^https?:$/.test(url.protocol)
    );
  } catch {
    return false;
  }
}

/** A Markdown destination is either a web URL or a local path, never an executable scheme.
 * Decode once here; the server resolves the resulting path within the session's workspace. */
export function localFilePath(destination: string): string | undefined {
  let path = destination.trim();
  if (!path || path.startsWith("//") || path.startsWith("#") || path.startsWith("?")) return;
  try {
    if (/^file:/i.test(path)) {
      const url = new URL(path);
      if (url.hostname || url.username || url.password || url.port) return;
      path = url.pathname;
    } else {
      if (/^[a-z][a-z\d+.-]*:/i.test(path)) return;
      path = path.split(/[?#]/, 1)[0];
    }
    path = decodeURIComponent(path);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: reject path control characters.
    return path && !/[\u0000-\u001f\u007f]/.test(path) ? path : undefined;
  } catch {
    return;
  }
}

/** Refuse excessive input before either parser runs. The tree budget below bounds generated
 * structure as well. Fallback is readable source, with no discovered links or image requests. */
export function markdownWithinBudget(source: string): boolean {
  if (source.length > 256 * 1024) return false;
  let work = source.length;
  let structure = 0;
  for (const line of source.split("\n")) {
    const prefix = line.match(/^(?:[ \t]*>[ \t]?)+/)?.[0] ?? "";
    const depth = (prefix.match(/>/g) ?? []).length;
    if (depth > 32) return false;
    work += depth * line.length;
    structure += (line.match(/[`|]/g) ?? []).length;
    if (work > 4 * 1024 * 1024 || structure > 20_000) return false;
  }
  return true;
}

type Node = Root | RootContent;
function walk(node: Node, visit: (node: Node) => void, depth = 0, budget = { nodes: 10_000 }) {
  if (depth > 32 || --budget.nodes < 0) throw new Error("Markdown budget exceeded");
  visit(node);
  if ("children" in node) for (const child of node.children) walk(child, visit, depth + 1, budget);
}

export interface MarkdownLink {
  url: string;
  label?: string;
  kind: "markdown" | "autolink" | "bare";
}

function linkKind(source: string): MarkdownLink["kind"] {
  return source.startsWith("[") ? "markdown" : source.startsWith("<") ? "autolink" : "bare";
}

/** Shared remark policy for Streamdown and discovery. No HTML is interpreted. */
export function remarkPiano() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    walk(tree, (node) => {
      if (node.type === "html") {
        // Keep raw markup readable, never executable.
        Object.assign(node, { type: "text" });
      }
      if (node.type === "code") {
        const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
        const lines = raw.split("\n");
        const fence = lines[0]?.match(/^(`{3,}|~{3,})/)?.[1];
        const end =
          lines
            .at(-1)
            ?.replace(/^(?:[ \t]*>[ \t]?)+/, "")
            .trim() ?? "";
        const closed =
          !!fence &&
          lines.length > 1 &&
          end.length >= fence.length &&
          [...end].every((char) => char === fence[0]);
        node.data = { ...node.data, hProperties: { "data-code-closed": closed } };
      }
      if (node.type === "link") {
        const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
        node.data = { ...node.data, hProperties: { "data-link-kind": linkKind(raw) } };
      }
    });
  };
}

export const markdownPlugins = [remarkGfm, remarkPiano];
const parser = unified().use(remarkParse).use(remarkGfm);
function parse(source: string): Root {
  if (!markdownWithinBudget(source)) throw new Error("Markdown budget exceeded");
  const tree = parser.parse(source);
  // Validate the whole tree before exposing any partial discovery.
  walk(tree, () => {});
  return tree;
}

/** Discover links from the same CommonMark/GFM grammar as the renderer, excluding code/images. */
export function markdownLinks(source: string): MarkdownLink[] {
  try {
    const tree = parse(source);
    const definitions = new Map<string, string>();
    walk(tree, (node) => {
      if (node.type === "definition") definitions.set(node.identifier, node.url);
    });
    const links: MarkdownLink[] = [];
    walk(tree, (node) => {
      if (node.type !== "link" && node.type !== "linkReference") return;
      const url = node.type === "link" ? node.url : definitions.get(node.identifier);
      if (!url || !/^https?:\/\//i.test(url)) return;
      const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
      const kind = node.type === "linkReference" ? "markdown" : linkKind(raw);
      const first = node.children[0]?.position?.start.offset;
      const last = node.children.at(-1)?.position?.end.offset;
      links.push({
        url,
        ...(kind === "markdown"
          ? { label: first === undefined ? "" : source.slice(first, last) }
          : {}),
        kind,
      });
    });
    return links;
  } catch {
    return [];
  }
}

/** Only local document images may be fetched, through the workspace-scoped file API. */
export function markdownImages(source: string): string[] {
  try {
    const tree = parse(source);
    const definitions = new Map<string, string>();
    walk(tree, (node) => {
      if (node.type === "definition") definitions.set(node.identifier, node.url);
    });
    const paths = new Set<string>();
    walk(tree, (node) => {
      const url =
        node.type === "image"
          ? node.url
          : node.type === "imageReference"
            ? definitions.get(node.identifier)
            : undefined;
      const path = url && localFilePath(url);
      if (path) paths.add(path);
    });
    return [...paths];
  } catch {
    return [];
  }
}
