import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/** Read-only text adapter. Tokenization runs off-thread and is killed on disposal or timeout. */
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
    // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki escapes source; only its token markup is inserted.
    return <div dangerouslySetInnerHTML={{ __html: highlighted.html }} />;
  return (
    <pre>
      <code>{content || "(Empty file)"}</code>
    </pre>
  );
}
