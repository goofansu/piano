import {
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  FileVideoIcon,
  ImageIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { FileNotice as Notice } from "@/components/FileNotice";
import { FileText } from "@/components/FileText";
import { LocalFileContext, Markdown } from "@/components/Markdown";
import { NativeFile } from "@/components/NativeFile";
import { RightSidebar } from "@/components/RightSidebar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { workspaceFile } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";

const relativeTo = (document: string, path: string) =>
  path.startsWith("/") ? path : `${document.slice(0, document.lastIndexOf("/") + 1)}${path}`;

const FilePdf = lazy(() =>
  import("@/components/FilePdf").catch(() => ({
    default: () => <Notice>Could not load the PDF viewer. Reload Piano and try again.</Notice>,
  })),
);

type Preview = Awaited<ReturnType<typeof workspaceFile>>;

const KIND_ICON: Record<Preview["kind"], typeof FileIcon> = {
  markdown: FileTextIcon,
  text: FileCodeIcon,
  image: ImageIcon,
  audio: FileAudioIcon,
  video: FileVideoIcon,
  pdf: FileIcon,
};

/** A file a local link opened, read-only, in the right sidebar.
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
  const [result, setResult] = useState<Preview>();
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
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const directory = slash > 0 ? path.slice(0, slash) : slash === 0 ? "/" : "";
  const Icon = result ? KIND_ICON[result.kind] : FileIcon;
  return (
    <RightSidebar
      label="File viewer"
      close={close}
      title={
        <>
          <Icon className="size-4 shrink-0 text-ink-3" aria-hidden />
          <span className="min-w-0 truncate" title={path}>
            {name}
          </span>
        </>
      }
      description={directory && <span className="truncate font-mono">{directory}</span>}
      actions={
        result?.kind === "markdown" && (
          <ToggleGroup
            type="single"
            variant="outline"
            value={mode}
            onValueChange={(value) => value && setMode(value)}
            aria-label="Markdown view"
            size="sm"
            className="mr-1"
          >
            <ToggleGroupItem value="preview">Preview</ToggleGroupItem>
            <ToggleGroupItem value="source">Source</ToggleGroupItem>
          </ToggleGroup>
        )
      }
    >
      {status && <Notice>{status}</Notice>}
      {result && (
        <section aria-label="File contents" className="flex min-h-full flex-col">
          {"bytes" in result ? (
            result.kind === "pdf" ? (
              <Suspense fallback={<Notice>Opening PDF…</Notice>}>
                <FilePdf bytes={result.bytes} />
              </Suspense>
            ) : binary?.result === result ? (
              <NativeFile key={binary.url} kind={result.kind} url={binary.url} name={path} />
            ) : null
          ) : result.kind === "markdown" && mode === "preview" ? (
            <LocalFileContext value={(path) => open(relativeTo(result.path, path))}>
              <Markdown
                text={result.content}
                className="prose-chat p-4 text-sm md:p-5"
                images={images}
                diagrams={false}
              />
            </LocalFileContext>
          ) : (
            <FileText content={result.content} language={result.language} />
          )}
        </section>
      )}
    </RightSidebar>
  );
}
