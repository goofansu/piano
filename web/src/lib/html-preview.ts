import * as css from "css-tree";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { FilePreview } from "../../../shared/files.ts";
import { localFilePath } from "./file-link.ts";
import {
  htmlPreviewBridge,
  type HtmlPreviewDocument,
  type HtmlPreviewLink,
} from "./html-preview-bridge.ts";
import { relativeToDocument } from "./markdownImageLoader.ts";

/** The existing workspace file reader, already bound to the selected workspace. */
export type HtmlPreviewReadFile = (path: string, signal: AbortSignal) => Promise<FilePreview>;

const maxHtml = 1024 * 1024;
const maxCss = 256 * 1024;
const maxCssTotal = 1024 * 1024;
const maxResourceBytes = 20 * 1024 * 1024;
const maxOutput = 32 * 1024 * 1024;
const maxNodes = 20_000;
const maxReads = 32;
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const tags = new Set(
  "html head body title a abbr address article aside b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark menu nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr".split(
    " ",
  ),
);
const attributes = new Set(
  "id class title lang dir hidden role aria-label aria-hidden aria-labelledby aria-describedby colspan rowspan scope headers start reversed value type width height alt datetime open".split(
    " ",
  ),
);
const groups = new Set(["media", "supports", "layer", "container"]);
// Functions whose arguments cannot implicitly load a string as a URL. In particular, image-set,
// image, paint, element and src are NOT admitted; escaped names are decoded before this check.
const functions = new Set(
  "var calc min max clamp round mod rem abs sign pow sqrt hypot log exp sin cos tan asin acos atan atan2 rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient translate translatex translatey translatez translate3d scale scalex scaley scalez scale3d rotate rotatex rotatey rotatez rotate3d skew skewx skewy matrix matrix3d perspective blur brightness contrast drop-shadow grayscale hue-rotate invert opacity saturate sepia cubic-bezier steps counter counters attr fit-content repeat minmax env".split(
    " ",
  ),
);
const policy = [
  "default-src 'none'",
  "script-src-attr 'none'",
  "script-src __BRIDGE_HASH__",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Only relative local references are automatic reads. The file seam still owns authorization. */
function localPath(base: string, reference: string): string | undefined {
  if (reference.length > 4096) return undefined;
  let value = reference.trim().split(/[?#]/, 1)[0]!;
  try {
    value = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  if (
    !value ||
    /[\\:]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    value.startsWith("/")
  )
    return undefined;
  // Do not collapse link/..: the server follows symlinks before resolving their parent.
  return `${base.slice(0, base.lastIndexOf("/") + 1)}${value}`
    .split("/")
    .filter((part) => part !== ".")
    .join("/");
}

function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Prepare a static, network-free HTML document. Browser-only; never attaches source nodes to the
 * live DOM. MUST be consumed as iframe srcdoc with sandbox="allow-scripts" ONLY, never innerHTML.
 * Only the fixed, CSP-hashed bridge runs; all authored code and hrefs are removed. The caller
 * owns a validated click listener and resolves indices against the returned destination table.
 * Fragments scroll without navigation. Details/summary remain native and interactive.
 *
 * Reads are sequential, cached per preparation, limited to 32 files / 20 MiB and ten seconds.
 * CSS imports have an eight-level bound; HTML has 20k-node / 64-level bounds. Unavailable or
 * disallowed resources disappear; cancellation and whole-document limits reject. No Blob URLs
 * or persistent resources are owned by this function. The caller owns workspace/stale-result
 * identity and must abort when that owner changes (INV-07, INV-11).
 */
export async function prepareHtmlPreview(
  content: string,
  path: string,
  readFile: HtmlPreviewReadFile,
  signal: AbortSignal,
): Promise<HtmlPreviewDocument> {
  signal.throwIfAborted();
  if (content.length > maxHtml) throw new Error("HTML preview exceeds the size limit.");
  const token = crypto.randomUUID();
  const links: HtmlPreviewLink[] = [];
  const hash = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(htmlPreviewBridge)),
      ),
    ),
  );
  signal.throwIfAborted();
  const documentPolicy = policy.replace("__BRIDGE_HASH__", `'sha256-${hash}'`);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("HTML preview preparation timed out.", "TimeoutError")),
    10_000,
  );
  const active = controller.signal;
  let resourceBytes = 0;
  let embeddedBytes = 0;
  let cssChars = 0;
  let nodes = 0;
  let reads = 0;
  const files = new Map<string, FilePreview | undefined>();
  const images = new Map<string, string | undefined>();

  // A caller that ignores cancellation must not keep preparation pending or return a stale result.
  const read = async (resource: string): Promise<FilePreview | undefined> => {
    active.throwIfAborted();
    if (files.has(resource)) return files.get(resource);
    if (reads >= maxReads || resourceBytes >= maxResourceBytes) return undefined;
    reads++;
    files.set(resource, undefined);
    let onAbort: () => void = () => {};
    try {
      const pending = new Promise<never>((_, reject) => {
        onAbort = () => reject(active.reason);
        active.addEventListener("abort", onAbort, { once: true });
      });
      const file = await Promise.race([readFile(resource, active), pending]);
      active.throwIfAborted();
      resourceBytes +=
        "content" in file ? new TextEncoder().encode(file.content).length : file.bytes.byteLength;
      if (resourceBytes > maxResourceBytes) return undefined;
      files.set(resource, file);
      files.set(file.path, file);
      return file;
    } catch {
      active.throwIfAborted();
      return undefined;
    } finally {
      active.removeEventListener("abort", onAbort);
    }
  };

  const image = async (reference: string, base: string): Promise<string | undefined> => {
    const resource = localPath(base, reference);
    if (!resource) return undefined;
    if (!images.has(resource)) {
      const file = await read(resource);
      let url: string | undefined;
      // SVG is safe only in image mode, never inline. Match the existing file-preview contract.
      if (file?.kind === "svg")
        url = dataUrl(new TextEncoder().encode(file.content), "image/svg+xml");
      else if (file?.kind === "image" && /^image\/(png|jpeg|gif|webp)$/.test(file.mime))
        url = dataUrl(file.bytes, file.mime);
      images.set(resource, url);
    }
    const url = images.get(resource);
    if (url) {
      embeddedBytes += url.length;
      if (embeddedBytes > maxOutput) throw new Error("HTML preview exceeds the resource limit.");
    }
    return url;
  };

  const safeCss = async (
    source: string,
    base: string,
    ancestors: ReadonlySet<string>,
    inline = false,
  ): Promise<string> => {
    active.throwIfAborted();
    cssChars += source.length;
    if (source.length > maxCss || cssChars > maxCssTotal) return "";
    let ast: css.CssNode;
    try {
      ast = css.parse(source, {
        context: inline ? "declarationList" : "stylesheet",
        parseCustomProperty: true,
      });
    } catch {
      return "";
    }
    // Bound parsed structure; recovered Raw nodes are rejected at their rule/declaration below.
    let count = 0;
    let depth = 0;
    let invalid = false;
    try {
      css.walk(ast, {
        enter() {
          if (++count > 30_000 || ++depth > 64) invalid = true;
        },
        leave() {
          depth--;
        },
      });
    } catch {
      return "";
    }
    if (invalid) return "";

    const render = async (node: css.CssNode, nesting: number): Promise<string> => {
      active.throwIfAborted();
      if (nesting > 32) return "";
      if (node.type === "StyleSheet" || node.type === "Block" || node.type === "DeclarationList") {
        let result = "";
        for (const child of node.children) {
          result += await render(child, nesting + 1);
          if (result.length > maxOutput)
            throw new Error("HTML preview exceeds the resource limit.");
        }
        return result;
      }
      if (node.type === "Rule") {
        if (
          node.prelude.type !== "SelectorList" ||
          css.find(node.prelude, (part) => part.type === "Raw")
        )
          return "";
        return `${css.generate(node.prelude)}{${await render(node.block, nesting + 1)}}`;
      }
      if (node.type === "Atrule") {
        if (node.prelude && css.find(node.prelude, (part) => part.type === "Raw")) return "";
        const name = css.ident.decode(node.name).toLowerCase();
        if (name === "import" && !node.block && node.prelude?.type === "AtrulePrelude") {
          if (ancestors.size >= 8) return "";
          const [url, media, ...extra] = node.prelude.children.toArray();
          if (!url || (url.type !== "Url" && url.type !== "String") || extra.length) return "";
          // Simple imports and media-qualified imports; layer()/supports() imports fail closed.
          if (media && media.type !== "MediaQueryList") return "";
          const resource = localPath(base, url.value);
          if (!resource || ancestors.has(resource)) return "";
          const file = await read(resource);
          if (!file || (file.kind !== "text" && file.kind !== "markdown")) return "";
          if (ancestors.has(file.path)) return "";
          const next = new Set(ancestors).add(file.path);
          const imported = await safeCss(file.content, file.path, next);
          return media ? `@media ${css.generate(media)}{${imported}}` : imported;
        }
        if (!groups.has(name) || !node.block) return "";
        // Group conditions never need URLs or arbitrary functions that could later become loads.
        if (
          node.prelude &&
          css.find(node.prelude, (part) => part.type === "Url" || part.type === "Raw")
        )
          return "";
        return `@${name} ${node.prelude ? css.generate(node.prelude) : ""}{${await render(node.block, nesting + 1)}}`;
      }
      if (node.type !== "Declaration") return "";
      const property = css.ident.decode(node.property).toLowerCase();
      if (/^(?:behavior|-moz-binding)$/.test(property)) return "";
      let unsafe = false;
      const urls: css.Url[] = [];
      css.walk(node.value, (part) => {
        if (part.type === "Raw") unsafe = true;
        if (part.type === "Url") urls.push(part);
        if (part.type === "Function" && !functions.has(css.ident.decode(part.name).toLowerCase()))
          unsafe = true;
      });
      if (unsafe) return "";
      for (const url of urls) {
        const bundled = await image(url.value, base);
        // Drop the complete declaration; keeping a partially rewritten fallback risks a load.
        if (!bundled) return "";
        url.value = bundled;
      }
      return `${css.generate(node)};`;
    };
    return render(ast, 0);
  };

  try {
    // A non-browser parser preserves document-root attributes without ever activating resources.
    // Only rebuilt allowlisted nodes enter a detached template's inert owner document.
    const source = parse(content);
    const output = document.createElement("template");
    const owner = output.content.ownerDocument;
    const append = async (
      input: DefaultTreeAdapterMap["node"],
      parent: Node,
      depth: number,
    ): Promise<void> => {
      active.throwIfAborted();
      if (++nodes > maxNodes || depth > 64)
        throw new Error("HTML preview exceeds the structure limit.");
      if ("value" in input && input.nodeName === "#text") {
        parent.appendChild(owner.createTextNode(input.value));
        return;
      }
      if (!("tagName" in input) || input.namespaceURI !== htmlNamespace) return;
      const element = input;
      const attributeValue = (name: string) =>
        element.attrs.find((attribute) => attribute.name === name && !attribute.namespace)?.value;
      const tag = element.tagName;
      if (
        tag === "style" ||
        (tag === "link" && attributeValue("rel")?.toLowerCase() === "stylesheet")
      ) {
        let text = "";
        if (tag === "style")
          text = await safeCss(
            element.childNodes.map((child) => ("value" in child ? child.value : "")).join(""),
            path,
            new Set(),
          );
        else {
          const resource = localPath(path, attributeValue("href") ?? "");
          if (resource) {
            const file = await read(resource);
            if (file && (file.kind === "text" || file.kind === "markdown"))
              text = await safeCss(file.content, file.path, new Set([file.path]));
          }
        }
        if (text) {
          const style = owner.createElement("style");
          const media = attributeValue("media");
          if (media && media.length <= 4096) style.setAttribute("media", media);
          // HTML raw-text serialization does not escape </style>, even inside a CSS string.
          style.textContent = text.replaceAll("<", "\\3c ");
          parent.appendChild(style);
        }
        return;
      }
      // Form prose and picture fallback images remain; forms, controls and remote sources do not.
      if (tag === "form" || tag === "picture") {
        for (const child of element.childNodes) await append(child, parent, depth + 1);
        return;
      }
      if (!tags.has(tag)) return;
      const clean = owner.createElement(tag);
      if (tag === "head")
        clean.innerHTML = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${documentPolicy}"><meta name="referrer" content="no-referrer">`;
      for (const attribute of element.attrs) {
        if (
          attributes.has(attribute.name) &&
          !attribute.namespace &&
          attribute.value.length <= 4096
        )
          clean.setAttribute(attribute.name, attribute.value);
      }
      if (tag === "a") {
        const href = attributeValue("href")?.trim();
        if (href !== undefined && href.length <= 4096) {
          if (href.startsWith("#")) {
            try {
              clean.setAttribute("data-piano-fragment", decodeURIComponent(href.slice(1)));
            } catch {
              /* An invalid fragment remains text. */
            }
          } else {
            let link: HtmlPreviewLink | undefined;
            // Match explicit Markdown web links: HTTP(S), a new tab, no opener or referrer.
            if (/^https?:\/\//i.test(href)) {
              try {
                const url = new URL(href);
                if (url.protocol === "http:" || url.protocol === "https:")
                  link = { kind: "web", url: url.href };
              } catch {
                /* Invalid web URLs remain text, never local paths. */
              }
            } else {
              const file = localFilePath(href);
              if (file) link = { kind: "file", path: relativeToDocument(path, file) };
            }
            if (link) {
              clean.setAttribute("data-piano-link", String(links.length));
              links.push(link);
            }
          }
          if (clean.hasAttribute("data-piano-link") || clean.hasAttribute("data-piano-fragment")) {
            clean.setAttribute("role", "link");
            clean.setAttribute("tabindex", "0");
          }
        }
      }
      const inlineStyle = attributeValue("style");
      if (inlineStyle) {
        const style = await safeCss(inlineStyle, path, new Set(), true);
        if (style) clean.setAttribute("style", style);
      }
      if (tag === "img") {
        const url = await image(attributeValue("src") ?? "", path);
        if (url) clean.setAttribute("src", url);
      }
      for (const child of element.childNodes) await append(child, clean, depth + 1);
      parent.appendChild(clean);
    };
    for (const child of source.childNodes) await append(child, output.content, 0);
    active.throwIfAborted();
    if (output.content.querySelector("a[data-piano-link],a[data-piano-fragment]")) {
      const style = owner.createElement("style");
      style.textContent =
        ":where(a[data-piano-link],a[data-piano-fragment]){color:LinkText;text-decoration:underline;cursor:pointer}";
      output.content.querySelector("head")!.appendChild(style);
    }
    const bridge = owner.createElement("script");
    bridge.setAttribute("data-piano-token", token);
    bridge.textContent = htmlPreviewBridge;
    output.content.querySelector("body")!.appendChild(bridge);
    const body = output.innerHTML;
    if (body.length > maxOutput) throw new Error("HTML preview exceeds the resource limit.");
    return { srcDoc: `<!doctype html>${body}`, token, links };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
