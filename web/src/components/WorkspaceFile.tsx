import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { workspaceFile } from "@/lib/api";

/** Inline complementary panel: unlike a modal Sheet it leaves the conversation usable.
 * No stock shadcn component provides a nonmodal, in-flow file viewer.
 * The owner keys it by session, workspace and path, so new destinations never flash old content. */
export function WorkspaceFile({
  workspaceId,
  file,
  close,
}: {
  workspaceId: string | undefined;
  file: { path: string };
  close: () => void;
}) {
  const [result, setResult] = useState<{ path: string; content: string }>();
  const [status, setStatus] = useState("Opening…");
  // A sidebar snapshot replaces workspace objects; only a new identity or link click rereads.
  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    setStatus("Opening…");
    if (!workspaceId) {
      setStatus("Workspace unavailable. Refresh folders and try the link again.");
      return;
    }
    void workspaceFile(workspaceId, file.path, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        setResult(result);
        setStatus("");
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setStatus(
            error instanceof Error
              ? error.message
              : "Could not read this file. Try the link again.",
          );
      },
    );
    return () => controller.abort();
  }, [file, workspaceId]);
  const path = result?.path ?? file.path;
  return (
    <aside
      aria-label="File viewer"
      className="flex min-h-0 min-w-0 basis-1/2 flex-col gap-3 border-t border-line p-4 md:w-2/5 md:max-w-xl md:shrink-0 md:basis-auto md:border-t-0 md:border-l"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate text-sm font-medium" title={path}>
          {path}
        </h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close file viewer" onClick={close}>
          <XIcon />
        </Button>
      </div>
      {status && (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
      {/* Plain text only: source HTML and Markdown must never execute or load remote resources. */}
      {result && (
        <section aria-label="File contents" className="min-h-0 flex-1 overflow-auto text-xs">
          <pre>
            <code>{result.content || "(Empty file)"}</code>
          </pre>
        </section>
      )}
    </aside>
  );
}
