import mermaid from "mermaid";
import DOMPurify from "dompurify";

let sequence = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Serialize configuration + rendering: Mermaid's configuration is global. */
export function renderDiagram(source: string, dark: boolean): Promise<string> {
  const result = queue.then(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // Diagram directives/frontmatter must not override host policy (including CSS).
      secure: [...Object.keys(mermaid.mermaidAPI.defaultConfig), "htmlLabels", "dompurifyConfig"],
      theme: dark ? "dark" : "default",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
    });
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:-100000px";
    document.body.append(container);
    try {
      const { svg } = await mermaid.render(`piano-mermaid-${++sequence}`, source, container);
      return DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ["foreignObject", "image", "a"],
      });
    } finally {
      container.remove();
    }
  });
  queue = result.catch(() => undefined);
  return result;
}
