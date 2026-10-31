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
  return isWebLinkTo(href, "linear.app");
}

export function isRadiusLink(href: string): boolean {
  return isWebLinkTo(href, "radius.earendil.com");
}

function isWebLinkTo(href: string, hostname: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.hostname === hostname &&
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
 * Read from the raw Markdown URL: a `%XX` escape decodes, and any other `%` is part of the name,
 * so `100%.png` is the file `100%.png`. The server resolves relative paths against the
 * session's workspace. */
function localFilePath(destination: string): string | undefined {
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
    // Escapes that are not UTF-8 throw: a name Piano cannot spell is not a local file.
    path = path.replace(/(?:%[\da-f]{2})+/gi, (escapes) => decodeURIComponent(escapes));
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

/** The element properties remark-rehype gives a node (its types live in mdast-util-to-hast). */
function hProperties(node: Node): Record<string, unknown> | undefined {
  return (node.data as { hProperties?: Record<string, unknown> } | undefined)?.hProperties;
}

/** Shared remark policy for Streamdown and discovery. No HTML is interpreted. */
export function remarkPiano() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const definitions = new Map<string, string>();
    walk(tree, (node) => {
      if (node.type === "definition") definitions.set(node.identifier, node.url);
    });
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
      // Each image and link's local file, decided once here from the Markdown URL, before
      // rendering re-encodes it: the images loaded are the images shown.
      const url =
        node.type === "image" || node.type === "link"
          ? node.url
          : node.type === "imageReference" || node.type === "linkReference"
            ? definitions.get(node.identifier)
            : undefined;
      const path = url === undefined ? undefined : localFilePath(url);
      if (path) {
        node.data = {
          ...node.data,
          hProperties: { ...hProperties(node), [LOCAL_PATH]: path },
        };
      }
    });
  };
}

/** The rendered element property naming an image or link's local file, if it has one. */
export const LOCAL_PATH = "data-local-path";

export const markdownPlugins = [remarkGfm, remarkPiano];
const parser = unified().use(remarkParse).use(remarkGfm);
function parse(source: string): Root {
  if (!markdownWithinBudget(source)) throw new Error("Markdown budget exceeded");
  const tree = parser.parse(source);
  // Validate the whole tree before exposing any partial discovery.
  walk(tree, () => {});
  remarkPiano()(tree, { value: source });
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
    const paths = new Set<string>();
    walk(tree, (node) => {
      if (node.type !== "image" && node.type !== "imageReference") return;
      const path = hProperties(node)?.[LOCAL_PATH];
      if (typeof path === "string") paths.add(path);
    });
    return [...paths];
  } catch {
    return [];
  }
}
