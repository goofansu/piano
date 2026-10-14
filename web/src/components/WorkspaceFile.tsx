import { XIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { FileText } from "@/components/FileText";
import { LocalFileContext, Markdown } from "@/components/Markdown";
import { NativeFile } from "@/components/NativeFile";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { workspaceFile } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";

const relativeTo = (document: string, path: string) =>
  path.startsWith("/") ? path : `${document.slice(0, document.lastIndexOf("/") + 1)}${path}`;

const FilePdf = lazy(() =>
  import("@/components/FilePdf").catch(() => ({
    default: () => <p role="status">Could not load the PDF viewer. Reload Piano and try again.</p>,
  })),
);

/** Inline complementary panel: unlike a modal Sheet it leaves the conversation usable.
 * No stock shadcn component provides a nonmodal, in-flow file viewer.
 * The owner keys it by session, workspace and path, so new destinations never flash old content. */
export function WorkspaceFile({
  workspaceId,
  file,
  close,
  open,
}: {
  workspaceId: string | undefined;
  file: { path: string };
  close: () => void;
  open: (path: string) => void;
}) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof workspaceFile>>>();
  const [mode, setMode] = useState("preview");
  const [status, setStatus] = useState("Opening…");
  // A sidebar snapshot replaces workspace objects; only a new identity or link click rereads.
  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    setMode("preview");
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
  const [binary, setBinary] = useState<{ result: typeof result; url: string }>();
  useEffect(() => {
    setBinary(undefined);
    if (!result || !("bytes" in result) || result.kind === "pdf") return;
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(result.bytes)], { type: result.mime }),
    );
    setBinary({ result, url });
    return () => URL.revokeObjectURL(url);
  }, [result]);
  const [images, setImages] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    setImages(new Map());
    if (result?.kind !== "markdown" || !workspaceId) return;
    const controller = new AbortController();
    const urls = new Map<string, string>();
    const document = new DOMParser().parseFromString(
      renderMarkdown(result.content, true),
      "text/html",
    );
    const paths = [
      ...new Set(
        Array.from(
          document.querySelectorAll<HTMLElement>("[data-local-image]"),
          (element) => element.dataset.localImage!,
        ),
      ),
    ].slice(0, 8);
    void (async () => {
      let total = 0;
      for (const path of paths) {
        if (controller.signal.aborted || total >= 20 * 1024 * 1024) break;
        try {
          const image = await workspaceFile(workspaceId, relativeTo(result.path, path), {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          if (image.kind !== "image") continue;
          total += image.bytes.byteLength;
          if (total > 20 * 1024 * 1024) break;
          urls.set(
            path,
            URL.createObjectURL(new Blob([new Uint8Array(image.bytes)], { type: image.mime })),
          );
          setImages(new Map(urls));
        } catch {
          /* Keep the image's local link usable for an explicit retry/error. */
        }
      }
    })();
    return () => {
      controller.abort();
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, [result, workspaceId]);
  const path = result?.path ?? file.path;
  return (
    // The read-only viewer owns native button/media keys, not the composer's type-to-focus hook.
    <aside
      onKeyDown={(event) => {
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey)
          event.stopPropagation();
      }}
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
      {result?.kind === "markdown" && (
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => value && setMode(value)}
          aria-label="Markdown view"
          size="sm"
        >
          <ToggleGroupItem value="preview">Preview</ToggleGroupItem>
          <ToggleGroupItem value="source">Source</ToggleGroupItem>
        </ToggleGroup>
      )}
      {result && (
        <section aria-label="File contents" className="min-h-0 flex-1 overflow-auto text-xs">
          {"bytes" in result ? (
            result.kind === "pdf" ? (
              <Suspense fallback={<p role="status">Opening PDF…</p>}>
                <FilePdf bytes={result.bytes} />
              </Suspense>
            ) : binary?.result === result ? (
              <NativeFile key={binary.url} kind={result.kind} url={binary.url} name={path} />
            ) : null
          ) : result.kind === "markdown" && mode === "preview" ? (
            <LocalFileContext value={(path) => open(relativeTo(result.path, path))}>
              <Markdown
                text={result.content}
                className="prose-chat"
                images={images}
                diagrams={false}
              />
            </LocalFileContext>
          ) : (
            <FileText content={result.content} language={result.language} />
          )}
        </section>
      )}
    </aside>
  );
}
