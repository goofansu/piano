import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef } from "react";
import { renderMarkdown } from "@/lib/markdown";

/** HTML-safe prose, enhanced with diagrams only after their closing fence arrives. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const html = useMemo(() => renderMarkdown(text), [text]);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Restore source when switching themes, or after an earlier async render.
    root.innerHTML = html;
    const blocks = Array.from(root.querySelectorAll<HTMLPreElement>("pre[data-mermaid]"));
    if (!blocks.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const { renderDiagram } = await import("@/lib/mermaid");
        for (const block of blocks) {
          if (cancelled) return;
          const source = block.textContent ?? "";
          // Oversized/invalid diagrams stay readable as code, without a persistent warning.
          if (!source.trim() || source.length > 50_000) continue;
          try {
            const svg = await renderDiagram(source, resolvedTheme === "dark");
            if (cancelled) return;
            const diagram = document.createElement("div");
            diagram.className = "mermaid-diagram";
            diagram.setAttribute("role", "img");
            diagram.setAttribute("aria-label", "Mermaid diagram");
            diagram.tabIndex = 0;
            // Isolate diagram CSS from the app. No shadcn primitive renders Mermaid SVG.
            const shadow = diagram.attachShadow({ mode: "open" });
            shadow.innerHTML = `<style>:host { display:block; overflow:auto; }</style>${svg}`;
            // Mermaid defaults to width:100%, which makes long diagrams illegible.
            // Keep SVG units at natural size; the focusable host owns overflow.
            const image = shadow.querySelector("svg");
            const bounds = image?.viewBox.baseVal;
            if (image && bounds && bounds.width > 0 && bounds.height > 0) {
              image.style.width = `${bounds.width}px`;
              image.style.height = `${bounds.height}px`;
              image.style.maxWidth = "none";
            }
            block.replaceWith(diagram);
          } catch {
            // Parsing/rendering failure is local to this block; keep its escaped source.
          }
        }
      } catch {
        // A failed lazy chunk load must not hide the response.
      }
    })();
    return () => { cancelled = true; };
  }, [html, resolvedTheme]);
  // Custom prose host: shadcn has no Markdown/Mermaid renderer. HTML is escaped by renderMarkdown.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes the source before adding markup.
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
