import { useTheme } from "next-themes";
import {
  Component,
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type Components, type ExtraProps, Streamdown, useIsCodeFenceIncomplete } from "streamdown";
import { CopyButton } from "@/components/CopyButton";
import { MarkdownWebLink } from "@/components/MarkdownWebLink";
import { LOCAL_PATH, markdownPlugins, markdownWithinBudget } from "@/lib/markdown";

/** The owning session supplies workspace-scoped preview navigation to every prose surface. */
export const LocalFileContext = createContext<(path: string) => void>(() => {});
const ImagesContext = createContext<ReadonlyMap<string, string> | undefined>(undefined);
const DiagramsContext = createContext(true);

function CopyCode({ text }: { text: string }) {
  return (
    <CopyButton
      text={text}
      label="Copy code"
      copiedLabel="Code copied"
      failure="Couldn’t copy. Select the code text to copy it."
      variant="outline-solid"
      reveal
      className="absolute top-4 right-2"
    />
  );
}

type MarkdownProps = {
  text: string;
  className?: string;
  images?: ReadonlyMap<string, string>;
  diagrams?: boolean;
  /** Conversations retain streaming block identities after completion; files use static mode. */
  mode?: "static" | "streaming";
  streaming?: boolean;
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

/** remarkPiano names each image and link's local file once, from its Markdown URL. */
function localPath(properties: Record<string, unknown> | undefined): string | undefined {
  const path = properties?.[LOCAL_PATH];
  return typeof path === "string" ? path : undefined;
}

function MarkdownLink({ href = "", children, title, node }: ComponentProps<"a"> & ExtraProps) {
  const openFile = useContext(LocalFileContext);
  const path = localPath(node?.properties);
  const images = useContext(ImagesContext);
  // An enabled local image owns its preview action, not the enclosing link's destination.
  // Avoid nested controls (or an outer web link opening a tab after the image click).
  if (
    images &&
    node?.children.some(
      (child) => child.type === "element" && child.tagName === "img" && localPath(child.properties),
    )
  )
    return <>{children}</>;
  if (path) {
    // Custom inline action: no shadcn primitive represents a Markdown local-file link.
    return (
      <button
        type="button"
        className="local-file-link"
        data-local-file={path}
        onClick={() => openFile(path)}
      >
        {children}
      </button>
    );
  }
  const kind = node?.properties["data-link-kind"];
  return (
    <MarkdownWebLink href={href} title={title} implicit={!!kind && kind !== "markdown"}>
      {children}
    </MarkdownWebLink>
  );
}

function MarkdownImage({ alt, node }: ComponentProps<"img"> & ExtraProps) {
  const images = useContext(ImagesContext);
  const openFile = useContext(LocalFileContext);
  const path = localPath(node?.properties);
  const url = path && images?.get(path);
  const [failed, setFailed] = useState<string>();
  if (!path || !images) return <>{alt}</>;
  // Only workspace-checked blobs, never Markdown resource URLs. Like local-file links, this
  // inline prose action has no shadcn equivalent; the image itself is the control, not a card.
  return (
    <span data-local-image={path}>
      <button
        type="button"
        className="local-file-link max-w-full align-middle"
        data-local-file={path}
        onClick={() => openFile(path)}
      >
        {url && url !== failed ? (
          <img
            src={url}
            alt={alt || "Image"}
            loading="lazy"
            className="max-h-48 max-w-[min(100%,12rem)] object-contain"
            onError={() => setFailed(url)}
          />
        ) : (
          alt || "Image"
        )}
      </button>
    </span>
  );
}

function MarkdownPre({ node }: ComponentProps<"pre"> & ExtraProps) {
  const code = node?.children.find((child) => child.type === "element" && child.tagName === "code");
  const text =
    code?.type === "element"
      ? code.children
          .map((child) => (child.type === "text" ? child.value : ""))
          .join("")
          .replace(/\n$/, "")
      : "";
  const language = code?.type === "element" ? String(code.properties.className ?? "") : "";
  const incomplete = useIsCodeFenceIncomplete();
  const closed = code?.type === "element" && code.properties["data-code-closed"] === true;
  const diagrams = useContext(DiagramsContext);
  const { resolvedTheme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    const host = ref.current;
    setRendered(false);
    if (
      !host ||
      !diagrams ||
      incomplete ||
      !closed ||
      language !== "language-mermaid" ||
      !text.trim() ||
      text.length > 50_000
    )
      return;
    let cancelled = false;
    void (async () => {
      try {
        const { renderDiagram } = await import("@/lib/mermaid");
        const svg = await renderDiagram(text, resolvedTheme === "dark");
        if (cancelled) return;
        const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
        shadow.innerHTML = `<style>:host { display:block; overflow:auto; } :host([hidden]) { display:none; }</style>${svg}`;
        const image = shadow.querySelector("svg");
        const bounds = image?.viewBox.baseVal;
        if (image && bounds && bounds.width > 0 && bounds.height > 0) {
          image.style.width = `${bounds.width}px`;
          image.style.height = `${bounds.height}px`;
          image.style.maxWidth = "none";
        }
        setRendered(true);
      } catch {
        // Invalid diagrams and failed lazy loads remain readable code.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text, language, incomplete, closed, diagrams, resolvedTheme]);
  // Custom code/diagram host: shadcn has no Markdown renderer or shadow-isolated Mermaid host.
  return (
    <div className="markdown-code-block">
      {!rendered && (
        <pre>
          <code>{text}</code>
        </pre>
      )}
      <div
        ref={ref}
        hidden={!rendered}
        data-mermaid-diagram=""
        role="img"
        aria-label="Mermaid diagram"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users scroll the diagram's overflow.
        tabIndex={0}
      />
      <CopyCode text={text} />
    </div>
  );
}

// Keep Piano typography and controls rather than importing Streamdown's alternative visual system.
const components: Components = {
  a: MarkdownLink,
  img: MarkdownImage,
  pre: MarkdownPre,
  code: "code",
  p: "p",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  ul: "ul",
  ol: "ol",
  li: "li",
  blockquote: "blockquote",
  strong: "strong",
  hr: "hr",
  table: ({ children }) => (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users scroll wide tables.
    <section className="markdown-table-scroll" aria-label="Table" tabIndex={0}>
      <table>{children}</table>
    </section>
  ),
  thead: "thead",
  tbody: "tbody",
  tr: "tr",
  th: "th",
  td: "td",
};
const rehypePlugins: [] = [];
// The custom link/image components own destination policy; no native URL is emitted unvalidated.
const urlTransform = (url: string) => url;

function MarkdownContent({
  text,
  className,
  images,
  diagrams = true,
  mode = "streaming",
  streaming = false,
}: MarkdownProps) {
  if (!markdownWithinBudget(text))
    return (
      <div className={className}>
        <pre>
          <code>{text}</code>
        </pre>
      </div>
    );
  return (
    <ImagesContext value={images}>
      <DiagramsContext value={diagrams}>
        <Streamdown
          className={className}
          mode={mode}
          isAnimating={streaming}
          parseIncompleteMarkdown={mode === "streaming" && streaming}
          components={components}
          remarkPlugins={markdownPlugins}
          rehypePlugins={rehypePlugins}
          skipHtml
          urlTransform={urlTransform}
          controls={false}
        >
          {text}
        </Streamdown>
      </DiagramsContext>
    </ImagesContext>
  );
}
