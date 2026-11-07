import { previewKindByName } from "@shared/files";
import {
  CopyIcon,
  DownloadIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  FileVideoIcon,
  ImageIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { FileNotice as Notice } from "@/components/FileNotice";
import { FilePath } from "@/components/FilePath";
import { IconButton } from "@/components/IconButton";
import { LocalFileContext, Markdown } from "@/components/Markdown";
import { NativeFile } from "@/components/NativeFile";
import { PianoViewToggle, PianoViewToggleItem } from "@/components/PianoViewToggle";
import { SurfaceFrame } from "@/components/SurfaceArea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WrapButton } from "@/components/WrapButton";
import { workspaceFileDownload } from "@/lib/api";
import { relativeToDocument } from "@/lib/file-link";
import type { FileTab } from "@/lib/navigation";
import { previewImage } from "@/lib/previewImage";
import { useMarkdownImages } from "@/lib/useMarkdownImages";
import { useNavigation } from "@/lib/useNavigation";

const FilePdf = lazy(() =>
  import("@/components/FilePdf").catch(() => ({
    default: () => <Notice>Could not load the PDF viewer. Reload Piano and try again.</Notice>,
  })),
);

const CodeFile = lazy(() =>
  import("@/components/Code").then(
    ({ CodeFile }) => ({ default: CodeFile }),
    () => ({
      default: () => <Notice>Could not load the source viewer. Reload Piano and try again.</Notice>,
    }),
  ),
);

const FileHtml = lazy(() =>
  import("@/components/FileHtml").catch(() => ({
    default: () => (
      <Notice>Could not load the HTML viewer. Turn off Preview to read the source.</Notice>
    ),
  })),
);

type Preview = NonNullable<FileTab["result"]>;

const KIND_ICON: Record<Preview["kind"], typeof FileIcon> = {
  markdown: FileTextIcon,
  html: FileCodeIcon,
  text: FileCodeIcon,
  svg: ImageIcon,
  image: ImageIcon,
  audio: FileAudioIcon,
  video: FileVideoIcon,
  pdf: FileIcon,
};

/** A file tab's icon, by the kind its extension suggests before the file is read. */
export function FileTabIcon({ path, className }: { path: string; className?: string }) {
  const Icon = KIND_ICON[previewKindByName(path) ?? "text"];
  return <Icon className={className} aria-hidden />;
}

/** Presents a navigation-owned acquisition, keyed by `file.key`, not its adopted path.
 * Renderers own only disposable presentation resources; they never initiate the file read. */
export function WorkspaceFile({ file, active }: { active: boolean; file: FileTab }) {
  const { openFile } = useNavigation();
  const { result, status, workspaceId } = file;
  const previewId = useId();
  const [mode, setMode] = useState("preview");
  const [binary, setBinary] = useState<{ result: typeof result; url: string }>();
  useEffect(() => {
    setBinary(undefined);
    if (!result || result.kind === "pdf") return;
    // Images (raster or SVG) as Markdown shows them; audio and video play their own bytes.
    const blob =
      previewImage(result) ??
      ("bytes" in result
        ? new Blob([new Uint8Array(result.bytes)], { type: result.mime })
        : undefined);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setBinary({ result, url });
    return () => URL.revokeObjectURL(url);
  }, [result]);
  const images = useMarkdownImages(
    workspaceId,
    mode === "preview" && result?.kind === "markdown" ? result.content : "",
    result?.path,
  );
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
  // Source text is on screen: a text file, or a document whose preview is off.
  const source =
    !!result &&
    !("bytes" in result) &&
    !(mode === "preview" && ["markdown", "html", "svg"].includes(result.kind));
  return (
    <SurfaceFrame
      tab={file}
      status={
        <div className="flex min-w-0 items-center gap-1">
          <FilePath path={path} />
          <IconButton
            size="header"
            label="Copy path"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(path);
                toast.success("Path copied");
              } catch {
                toast.error("Couldn’t copy path.");
              }
            }}
          >
            <CopyIcon />
          </IconButton>
        </div>
      }
      actions={
        <>
          {(result?.kind === "markdown" || result?.kind === "html") && (
            <div className="flex items-center gap-2 px-3">
              <Label htmlFor={previewId}>Preview</Label>
              <Switch
                id={previewId}
                checked={mode === "preview"}
                onCheckedChange={(checked) => setMode(checked ? "preview" : "source")}
              />
            </div>
          )}
          {result?.kind === "svg" && (
            <PianoViewToggle
              type="single"
              value={mode}
              onValueChange={(value) => value && setMode(value)}
              aria-label="SVG view"
            >
              <PianoViewToggleItem value="preview">Preview</PianoViewToggleItem>
              <PianoViewToggleItem value="source">Source</PianoViewToggleItem>
            </PianoViewToggle>
          )}
          {source && <WrapButton />}
          <IconButton
            size="header"
            label="Download file"
            disabled={!result || saving}
            onClick={save}
          >
            <DownloadIcon />
          </IconButton>
        </>
      }
    >
      {status && <Notice>{status}</Notice>}
      {result && (
        <section aria-label="File contents" className="flex min-h-full flex-col">
          {result.kind === "html" && workspaceId && (
            <div hidden={mode !== "preview"}>
              <Suspense fallback={<Notice>Opening HTML…</Notice>}>
                <FileHtml
                  content={result.content}
                  path={result.path}
                  workspaceId={workspaceId}
                  active={active && mode === "preview"}
                />
              </Suspense>
            </div>
          )}
          {result.kind === "html" && mode === "preview" ? null : "bytes" in result ? (
            result.kind === "pdf" ? (
              <Suspense fallback={<Notice>Opening PDF…</Notice>}>
                <FilePdf bytes={result.bytes} />
              </Suspense>
            ) : binary?.result === result ? (
              <NativeFile key={binary.url} kind={result.kind} url={binary.url} name={path} />
            ) : null
          ) : result.kind === "svg" && mode === "preview" ? (
            binary?.result === result ? (
              <NativeFile key={binary.url} kind="image" url={binary.url} name={path} svg />
            ) : null
          ) : result.kind === "markdown" && mode === "preview" ? (
            <LocalFileContext
              // A link in a file opens beside it, in the Surface area.
              value={(path) => openFile(relativeToDocument(result.path, path), "surface")}
            >
              <Markdown
                text={result.content}
                mode="static"
                className="prose-chat p-4 text-sm md:p-5"
                images={images}
                diagrams={false}
              />
            </LocalFileContext>
          ) : (
            <Suspense fallback={<Notice>Opening source…</Notice>}>
              <CodeFile name={result.path} content={result.content} language={result.language} />
            </Suspense>
          )}
        </section>
      )}
    </SurfaceFrame>
  );
}
