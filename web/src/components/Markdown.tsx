import { useTheme } from "next-themes";
import {
  Component,
  type ComponentProps,
  createContext,
  type CSSProperties,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import remarkBreaks from "remark-breaks";
import { type Components, type ExtraProps, Streamdown, useIsCodeFenceIncomplete } from "streamdown";
import { CopyButton } from "@/components/CopyButton";
import { MarkdownWebLink } from "@/components/MarkdownWebLink";
import type { FenceLines } from "@/lib/fenceHighlight";
import { LOCAL_PATH, markdownPlugins, markdownWithinBudget } from "@/lib/markdown";

export const LocalFileContext = createContext<((path: string) => void) | undefined>(() => {});
const ImagesContext = createContext<ReadonlyMap<string, string> | undefined>(undefined);
const DiagramsContext = createContext(true);

function CopyCode({ text }: { text: string }) {
  return (
    <CopyButton
      text={text}
      label="Copy code"
      copiedLabel="Code copied"
      failure="Could not copy. Select the code text to copy it."
      variant="ghost"
      className="absolute top-4 right-2"
    />
  );
}

type MarkdownProps = {
  text: string;
  className?: string;
  images?: ReadonlyMap<string, string>;
  diagrams?: boolean;
  mode?: "static" | "streaming";
  streaming?: boolean;
  preserveLineBreaks?: boolean;
};

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

function localPath(properties: Record<string, unknown> | undefined): string | undefined {
  const path = properties?.[LOCAL_PATH];
  return typeof path === "string" ? path : undefined;
}

function MarkdownLink({ href = "", children, title, node }: ComponentProps<"a"> & ExtraProps) {
  const openFile = useContext(LocalFileContext);
  const path = localPath(node?.properties);
  const images = useContext(ImagesContext);
  if (
    images &&
    node?.children.some(
      (child) => child.type === "element" && child.tagName === "img" && localPath(child.properties),
    )
  )
    return <>{children}</>;
  if (path && !openFile) return <>{children}</>;
  if (path && openFile) {
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
  if (!path || !images || !openFile) return <>{alt}</>;
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

let fenceHighlighter: typeof import("@/lib/fenceHighlight") | undefined;

function useFenceHighlight(text: string, language: string, enabled: boolean) {
  const lang = language.replace(/^language-/, "");
  const cached = enabled && lang ? fenceHighlighter?.highlightedFence(text, lang) : undefined;
  const [found, setFound] = useState<{ text: string; lang: string; lines: FenceLines }>();
  useEffect(() => {
    if (!enabled || !lang || cached) return;
    let cancelled = false;
    void (async () => {
      fenceHighlighter ??= await import("@/lib/fenceHighlight");
      const lines = await fenceHighlighter.highlightFence(text, lang);
      if (!cancelled && lines) setFound({ text, lang, lines });
    })();
    return () => {
      cancelled = true;
    };
  }, [text, lang, enabled, cached]);
  if (!enabled) return undefined;
  return cached ?? (found?.text === text && found.lang === lang ? found.lines : undefined);
}

function FenceCode({ lines }: { lines: FenceLines }) {
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 && "\n"}
      {line.map(([text, light, dark], at) =>
        light || dark ? (
          <span
            key={at}
            className="code-token"
            style={{ "--token-light": light, "--token-dark": dark } as CSSProperties}
          >
            {text}
          </span>
        ) : (
          text
        ),
      )}
    </Fragment>
  ));
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
  const mermaid = diagrams && language === "language-mermaid";
  const lines = useFenceHighlight(text, language, closed && !incomplete && !mermaid);
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
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [text, language, incomplete, closed, diagrams, resolvedTheme]);
  return (
    <div className="markdown-code-block">
      {!rendered && (
        <pre>
          <code>{lines ? <FenceCode lines={lines} /> : text}</code>
        </pre>
      )}
      <div
        ref={ref}
        hidden={!rendered}
        data-mermaid-diagram=""
        role="img"
        aria-label="Mermaid diagram"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users scroll the diagram's overflow.
        tabIndex={0}
      />
      <CopyCode text={text} />
    </div>
  );
}

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
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users scroll wide tables.
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
const messagePlugins = [...markdownPlugins, remarkBreaks];
const rehypePlugins: [] = [];
const urlTransform = (url: string) => url;

function MarkdownContent({
  text,
  className,
  images,
  diagrams = true,
  mode = "streaming",
  streaming = false,
  preserveLineBreaks = false,
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
          remarkPlugins={preserveLineBreaks ? messagePlugins : markdownPlugins}
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
