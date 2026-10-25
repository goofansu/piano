import { useTheme } from "next-themes";
import { type CSSProperties, useEffect, useState } from "react";
import { lineBlocks } from "@/lib/lineBlocks";

/** Read-only text adapter. Tokenization runs off-thread and is killed on disposal or timeout.
 * The highlighted rendering is one `span.line` per line, which the `file-source` style numbers;
 * the plain one, used for every long file, is blocks of lines, each one text beside its gutter. */
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
  // A few elements per block, not per line, and blocks off screen skip layout and paint, so a
  // long file opens without blocking the page.
  return (
    <div className="file-source">
      <pre>
        <code className="block w-max min-w-full">
          {lineBlocks(lines).map((block) => (
            <span
              key={block.start}
              className="lazy-lines flex"
              style={{ "--lines": block.items.length } as CSSProperties}
            >
              <span className="file-gutter" aria-hidden>
                {block.items.map((_, i) => block.start + i + 1).join("\n")}
              </span>
              <span>{block.items.join("\n")}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
