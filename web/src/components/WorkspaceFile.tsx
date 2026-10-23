import {
  DownloadIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  FileVideoIcon,
  ImageIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileNotice as Notice } from "@/components/FileNotice";
import { FileText } from "@/components/FileText";
import { IconButton } from "@/components/IconButton";
import { LocalFileContext, Markdown } from "@/components/Markdown";
import { NativeFile } from "@/components/NativeFile";
import { PianoViewToggle, PianoViewToggleItem } from "@/components/PianoViewToggle";
import { RightSidebar } from "@/components/RightSidebar";
import { workspaceFile, workspaceFileDownload } from "@/lib/api";
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
    if (mode !== "preview" || result?.kind !== "markdown" || !workspaceId) return;
    const controller = new AbortController();
    const urls = new Map<string, string>();
    let paths: string[];
    try {
      const document = new DOMParser().parseFromString(
        renderMarkdown(result.content, true),
        "text/html",
      );
      paths = [
        ...new Set(
          Array.from(
            document.querySelectorAll<HTMLElement>("[data-local-image]"),
            (element) => element.dataset.localImage!,
          ),
        ),
      ].slice(0, 8);
    } catch {
      // Image enhancement is optional; preview fallback and Source must remain available.
      return;
    }
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
  }, [mode, result, workspaceId]);
  const [saving, setSaving] = useState(false);
  // The browser saves the file through a short-lived object URL; the server sends exact bytes.
  const save = async () => {
    if (!workspaceId || saving) return;
    setSaving(true);
    try {
      const { name, mime, bytes } = await workspaceFileDownload(workspaceId, file.path);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
      const anchor = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download this file.");
    } finally {
      setSaving(false);
    }
  };
  const path = result?.path ?? file.path;
  const Icon = result ? KIND_ICON[result.kind] : FileIcon;
  return (
    <RightSidebar
      label="File viewer"
      close={close}
      title={
        <>
          <Icon className="size-4 shrink-0 text-ink-3" aria-hidden />
          <span className="min-w-0 truncate font-mono text-xs font-normal" title={path}>
            {path}
          </span>
        </>
      }
      actions={
        <IconButton
          label="Download file"
          disabled={!result || saving}
          onClick={save}
          className="pointer-coarse:size-11"
        >
          <DownloadIcon />
        </IconButton>
      }
      toolbar={
        result?.kind === "markdown" && (
          <PianoViewToggle
            type="single"
            value={mode}
            onValueChange={(value) => value && setMode(value)}
            aria-label="Markdown view"
          >
            <PianoViewToggleItem value="preview">Preview</PianoViewToggleItem>
            <PianoViewToggleItem value="source">Source</PianoViewToggleItem>
          </PianoViewToggle>
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
