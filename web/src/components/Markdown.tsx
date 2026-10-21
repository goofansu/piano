import { CheckIcon, CopyIcon } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Component,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
      className="absolute top-4 right-2"
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

type MarkdownProps = {
  text: string;
  className?: string;
  images?: ReadonlyMap<string, string>;
  diagrams?: boolean;
};

/** Keep unexpected render/layout-effect failures inside this prose surface, not the session or
 * file viewer controls. New content retries; unrelated rerenders do not loop on the same error. */
class MarkdownBoundary extends Component<MarkdownProps & { children: ReactNode }> {
  state = { text: this.props.text, failed: false };

  static getDerivedStateFromProps(props: MarkdownProps, state: { text: string }) {
    return props.text === state.text ? null : { text: props.text, failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // Custom escaped-source host: shadcn has no Markdown error fallback. React escapes the text.
    return (
      <div className={this.props.className}>
        <div className="whitespace-pre-wrap break-words">{this.props.text}</div>
      </div>
    );
  }
}

export function Markdown(props: MarkdownProps) {
  return (
    <MarkdownBoundary text={props.text} className={props.className}>
      <MarkdownContent {...props} />
    </MarkdownBoundary>
  );
}

/** HTML-safe prose, enhanced with diagrams only after their closing fence arrives. */
function MarkdownContent({ text, className, images, diagrams = true }: MarkdownProps) {
  const openFile = useContext(LocalFileContext);
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const html = useMemo(() => renderMarkdown(text, images !== undefined), [text, images]);
  // Seed server/initial rendering only; the layout effect owns subsequent DOM updates.
  const initialHtml = useRef(html);
  const [codeBlocks, setCodeBlocks] = useState<{ host: HTMLDivElement; text: string }[]>([]);
  const hosts = useRef<HTMLDivElement[]>([]);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Build offscreen and retain portal hosts: streaming must not remount copy controls.
    // Commit before paint so code never appears without its control.
    const next = document.createElement("div");
    next.innerHTML = html;
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const codeBlocks = Array.from(next.querySelectorAll<HTMLPreElement>("pre")).map(
      (block, index) => {
        // Custom code host: shadcn has no HTML-string Markdown renderer. The control is a portal.
        const host = hosts.current[index] ?? document.createElement("div");
        host.className = "markdown-code-block";
        block.replaceWith(host);
        // Leave React's portal children intact, replacing only code/diagram content.
        host.querySelector("pre, .mermaid-diagram")?.remove();
        host.prepend(block);
        return { host, text: block.querySelector("code")?.textContent ?? "" };
      },
    );
    hosts.current = codeBlocks.map(({ host }) => host);
    root.replaceChildren(...next.childNodes);
    if (focused instanceof HTMLElement && root.contains(focused))
      focused.focus({ preventScroll: true });
    setCodeBlocks(codeBlocks);
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
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes source before adding markup.
        dangerouslySetInnerHTML={{ __html: initialHtml.current }}
      />
      {codeBlocks.map(({ host, text }, index) =>
        createPortal(<CopyCode text={text} />, host, String(index)),
      )}
    </>
  );
}
