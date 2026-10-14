import { CheckIcon, CopyIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { IconButton } from "@/components/IconButton";
import { renderMarkdown } from "@/lib/markdown";

/** The owning session supplies workspace-scoped preview navigation to every prose surface. */
export const LocalFileContext = createContext<(path: string) => void>(() => {});

function CopyCode({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <IconButton
      label={copied ? "Code copied" : "Copy code"}
      size="icon-xs"
      className="absolute top-2 right-2"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          toast.error("Couldn’t copy. Select the code text to copy it.");
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  );
}

/** HTML-safe prose, enhanced with diagrams only after their closing fence arrives. */
export function Markdown({
  text,
  className,
  images,
  diagrams = true,
}: {
  text: string;
  className?: string;
  images?: ReadonlyMap<string, string>;
  diagrams?: boolean;
}) {
  const openFile = useContext(LocalFileContext);
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const html = useMemo(() => renderMarkdown(text, images !== undefined), [text, images]);
  const [codeBlocks, setCodeBlocks] = useState<{ host: HTMLDivElement; text: string }[]>([]);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Restore source when switching themes, or after an earlier async render.
    root.innerHTML = html;
    setCodeBlocks(
      Array.from(root.querySelectorAll<HTMLPreElement>("pre")).map((block) => {
        // Custom code host: shadcn has no HTML-string Markdown renderer. The control is a portal.
        const host = document.createElement("div");
        host.className = "markdown-code-block";
        block.replaceWith(host);
        host.append(block);
        return { host, text: block.querySelector("code")?.textContent ?? "" };
      }),
    );
    for (const host of root.querySelectorAll<HTMLElement>("[data-local-image]")) {
      const url = images?.get(host.dataset.localImage!);
      if (!url) continue;
      const img = document.createElement("img");
      img.alt = host.textContent ?? "Image";
      img.src = url;
      img.style.maxWidth = "100%";
      img.onerror = () => img.remove();
      host.prepend(img);
    }
    const blocks = diagrams
      ? Array.from(root.querySelectorAll<HTMLPreElement>("pre[data-mermaid]"))
      : [];
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
    return () => {
      cancelled = true;
    };
  }, [html, resolvedTheme, images, diagrams]);
  // Custom prose host: shadcn has no Markdown/Mermaid renderer. HTML is escaped by renderMarkdown.
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: delegates native button clicks from the HTML-string renderer, including keyboard activation. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the generated buttons already provide Enter and Space activation. */}
      <div
        ref={ref}
        className={className}
        onClick={(event) => {
          const button =
            event.target instanceof Element
              ? event.target.closest<HTMLButtonElement>("button[data-local-file]")
              : null;
          if (button && event.currentTarget.contains(button)) openFile(button.dataset.localFile!);
        }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes the source before adding markup.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {codeBlocks.map(({ host, text }, index) =>
        createPortal(<CopyCode text={text} />, host, String(index)),
      )}
    </>
  );
}
