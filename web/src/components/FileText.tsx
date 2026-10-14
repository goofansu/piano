import { useTheme } from "next-themes";
import { Fragment, useEffect, useState } from "react";

/** Read-only text adapter. Tokenization runs off-thread and is killed on disposal or timeout.
 * Both the highlighted and the plain rendering are one `span.line` per line, which the
 * `file-source` style numbers. */
export function FileText({ content, language }: { content: string; language: string }) {
  const { resolvedTheme } = useTheme();
  const [highlighted, setHighlighted] = useState<{
    content: string;
    dark: boolean;
    html: string;
  }>();
  const dark = resolvedTheme === "dark";
  useEffect(() => {
    if (
      !language ||
      content.length > 65_536 ||
      content.split("\n").some((line) => line.length > 2000)
    )
      return;
    const worker = new Worker(new URL("../lib/file-highlight.ts", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(() => worker.terminate(), 3000);
    worker.onmessage = ({ data }: MessageEvent<string>) => {
      setHighlighted({ content, dark, html: data });
      clearTimeout(timer);
      worker.terminate();
    };
    worker.postMessage({ content, language, dark });
    return () => {
      clearTimeout(timer);
      worker.terminate();
    };
  }, [content, language, dark]);
  if (highlighted?.content === content && highlighted.dark === dark)
    return (
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki escapes source; only its token markup is inserted.
      <div className="file-source" dangerouslySetInnerHTML={{ __html: highlighted.html }} />
    );
  if (!content) return <p className="p-4 text-sm text-ink-3">(Empty file)</p>;
  const lines = content.replace(/\n$/, "").split("\n");
  return (
    <div className="file-source">
      <pre>
        <code>
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and never reorder.
            <Fragment key={i}>
              {i > 0 && "\n"}
              <span className="line">{line}</span>
            </Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
}
