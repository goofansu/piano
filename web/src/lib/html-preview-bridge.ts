/** Fixed trusted code, hashed into the preview CSP. Never interpolate document text here.
 * No hrefs, eval, network, inbound messages, or document-controlled property lookup on globals.
 * The opaque frame may report only an index on a real user activation; the parent owns URLs.
 */
export const htmlPreviewBridge = `(() => {
  const token = document.currentScript.getAttribute("data-piano-token");
  const links = new Map(Array.from(document.querySelectorAll("a[data-piano-link],a[data-piano-fragment]"), a => [a, {
    index: a.getAttribute("data-piano-link"), fragment: a.getAttribute("data-piano-fragment")
  }]));
  const activate = event => {
    if (!event.isTrusted || (event.type === "keydown" && (event.key !== "Enter" || event.repeat)) ||
        (event.type === "click" && event.button !== 0)) return;
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    const link = links.get(anchor);
    if (!link) return;
    event.preventDefault();
    if (link.fragment !== null) {
      if (!link.fragment) { window.scrollTo(0, 0); return; }
      const target = document.getElementById(link.fragment);
      if (target) {
        for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (ancestor.tagName === "DETAILS") ancestor.open = true;
        }
        target.scrollIntoView();
        if (!target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
          target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
        }
        target.focus({ preventScroll: true });
      }
      return;
    }
    window.parent.postMessage({ type: "piano-html-link", token, index: Number(link.index) }, "*");
  };
  document.addEventListener("click", activate);
  document.addEventListener("keydown", activate);
})();`;

export type HtmlPreviewLink =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "web"; readonly url: string };

export interface HtmlPreviewDocument {
  readonly srcDoc: string;
  readonly token: string;
  readonly links: readonly HtmlPreviewLink[];
}

/** Install for exactly one committed frame/document. Cleanup closes admission synchronously.
 * Origin "null" alone is NOT identity. Neither destinations nor workspace IDs come from messages.
 */
export function listenHtmlPreviewLinks(
  host: Window,
  frame: HTMLIFrameElement,
  preview: HtmlPreviewDocument,
  open: (link: HtmlPreviewLink) => void,
): () => void {
  let active = true;
  const receive = (event: MessageEvent<unknown>) => {
    if (
      !active ||
      !event.isTrusted ||
      event.origin !== "null" ||
      event.source !== frame.contentWindow
    )
      return;
    const data = event.data;
    if (
      typeof data !== "object" ||
      data === null ||
      Array.isArray(data) ||
      Object.keys(data).length !== 3 ||
      !("type" in data) ||
      data.type !== "piano-html-link" ||
      !("token" in data) ||
      data.token !== preview.token ||
      !("index" in data) ||
      typeof data.index !== "number" ||
      !Number.isSafeInteger(data.index) ||
      data.index < 0 ||
      data.index >= preview.links.length
    )
      return;
    open(preview.links[data.index]!);
  };
  host.addEventListener("message", receive);
  return () => {
    active = false;
    host.removeEventListener("message", receive);
  };
}
