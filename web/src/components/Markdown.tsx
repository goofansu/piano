import { DownloadIcon, ExternalLinkIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { renderMarkdown } from "@/lib/markdown";

type FileContext = { workspaceId: string; sessionId: string };
type Ready = { status: "ready"; name: string; kind: "text" | "markdown" | "image" | "download"; mimeType: string; bytes: number; previewUrl?: string; downloadUrl: string };
type Approval = { status: "approval-required"; approvalId: string; path: string };
type FileResult = Ready | Approval;
type FileState = { href: string; result?: FileResult; error?: string; busy: boolean };

async function filePost(action: "request" | "approve", body: Record<string, string>): Promise<FileResult> {
  const response = await fetch(`/api/file-links/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json() as FileResult & { error?: string };
  if (!response.ok) throw new Error(value.error || "Piano could not open this file.");
  return value;
}

/** HTML-safe prose, enhanced with diagrams only after their closing fence arrives. */
export function Markdown({ text, className, fileContext }: { text: string; className?: string; fileContext?: FileContext }) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const html = useMemo(() => renderMarkdown(text, fileContext ? { fileLinks: true } : undefined), [text, fileContext]);
  const [file, setFile] = useState<FileState>();
  const fileRequest = useRef(0);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Restore source when switching themes, or after an earlier async render.
    root.innerHTML = html;
    const blocks = Array.from(root.querySelectorAll<HTMLPreElement>("pre[data-mermaid]"));
    if (!blocks.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const { renderDiagram } = await import("@/lib/mermaid");
        for (const block of blocks) {
          if (cancelled) return;
          const source = block.textContent ?? "";
          // Oversized/invalid diagrams stay readable as code, without a persistent warning.
          if (!source.trim() || source.length > 50_000) continue;
          try {
            const svg = await renderDiagram(source, resolvedTheme === "dark");
            if (cancelled) return;
            const diagram = document.createElement("div");
            diagram.className = "mermaid-diagram";
            diagram.setAttribute("role", "img");
            diagram.setAttribute("aria-label", "Mermaid diagram");
            diagram.tabIndex = 0;
            // Isolate diagram CSS from the app. No shadcn primitive renders Mermaid SVG.
            const shadow = diagram.attachShadow({ mode: "open" });
            shadow.innerHTML = `<style>:host { display:block; overflow:auto; }</style>${svg}`;
            // Mermaid defaults to width:100%, which makes long diagrams illegible.
            // Keep SVG units at natural size; the focusable host owns overflow.
            const image = shadow.querySelector("svg");
            const bounds = image?.viewBox.baseVal;
            if (image && bounds && bounds.width > 0 && bounds.height > 0) {
              image.style.width = `${bounds.width}px`;
              image.style.height = `${bounds.height}px`;
              image.style.maxWidth = "none";
            }
            block.replaceWith(diagram);
          } catch {
            // Parsing/rendering failure is local to this block; keep its escaped source.
          }
        }
      } catch {
        // A failed lazy chunk load must not hide the response.
      }
    })();
    return () => { cancelled = true; };
  }, [html, resolvedTheme]);

  useEffect(() => () => { fileRequest.current++; }, []);
  const closeFile = useCallback(() => { fileRequest.current++; setFile(undefined); }, []);
  const requestFile = useCallback(async (href: string) => {
    if (!fileContext) return;
    const request = ++fileRequest.current;
    setFile({ href, busy: true });
    try {
      const result = await filePost("request", { ...fileContext, href });
      if (fileRequest.current === request) setFile({ href, result, busy: false });
    } catch (error) {
      if (fileRequest.current === request) setFile({ href, error: error instanceof Error ? error.message : String(error), busy: false });
    }
  }, [fileContext]);
  const approveFile = useCallback(async (href: string, approval: Approval) => {
    if (!fileContext) return;
    const request = ++fileRequest.current;
    setFile({ href, result: approval, busy: true });
    try {
      const result = await filePost("approve", { ...fileContext, approvalId: approval.approvalId, path: approval.path });
      if (fileRequest.current === request) setFile({ href, result, busy: false });
    } catch (error) {
      if (fileRequest.current === request) setFile({ href, error: error instanceof Error ? error.message : String(error), busy: false });
    }
  }, [fileContext]);

  return <>
    {/* Custom prose host: shadcn has no Markdown/Mermaid renderer. HTML is escaped by renderMarkdown. */}
    {/* The listener delegates to actual anchors, whose Enter activation emits click. */}
    {/* biome-ignore-start lint/security/noDangerouslySetInnerHtml lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: safe renderer and delegated anchor activation. */}
    <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} onClick={(event) => {
      const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[data-file-href]");
      if (!anchor) return;
      event.preventDefault();
      if (fileContext) void requestFile(anchor.dataset.fileHref!);
    }} />
    {/* biome-ignore-end lint/security/noDangerouslySetInnerHtml lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: range closes. */}
    {fileContext && <FileDialog file={file} onClose={closeFile} onApprove={approveFile} />}
  </>;
}

function FileDialog({ file, onClose, onApprove }: { file: FileState | undefined; onClose: () => void; onApprove: (href: string, approval: Approval) => void }) {
  const ready = file?.result?.status === "ready" ? file.result : undefined;
  const approval = file?.result?.status === "approval-required" ? file.result : undefined;
  const [preview, setPreview] = useState<string>();
  const [previewError, setPreviewError] = useState<string>();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string>();
  useEffect(() => {
    setPreview(undefined);
    setPreviewError(undefined);
    if (!ready?.previewUrl || (ready.kind !== "text" && ready.kind !== "markdown")) return;
    const controller = new AbortController();
    let current = true;
    void fetch(ready.previewUrl, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Preview expired. Open the link again.");
      const text = await response.text();
      if (current) setPreview(text);
    }).catch(error => { if (current && error.name !== "AbortError") setPreviewError(error.message); });
    return () => { current = false; controller.abort(); };
  }, [ready?.previewUrl, ready?.kind]);
  useEffect(() => {
    setDownloading(false);
    setDownloadError(undefined);
  }, [ready?.downloadUrl]);

  const downloadCopy = useCallback(async () => {
    if (!ready) return;
    setDownloading(true);
    setDownloadError(undefined);
    let objectUrl: string | undefined;
    try {
      const response = await fetch(ready.downloadUrl);
      if (!response.ok) throw new Error("unavailable");
      objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = ready.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setDownloadError("Download expired or is unavailable. Open the file link again.");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setDownloading(false);
    }
  }, [ready]);

  if (!file) return null;
  const title = file.busy ? "Opening file…" : approval ? "Approve access to this file?" : ready ? ready.kind === "download" ? "Download file" : ready.name : "Couldn’t open file";
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[min(90dvh,48rem)] flex-col overflow-hidden sm:max-w-3xl">
      <DialogHeader className="shrink-0">
        <DialogTitle>{title}</DialogTitle>
        {approval ? <DialogDescription>Piano normally reads only the session workspace. Allow one copied snapshot of this exact server file:</DialogDescription>
          : ready?.kind === "download" ? <DialogDescription>Preview isn’t supported for this format. You can download a copy.</DialogDescription>
          : ready ? <DialogDescription>{ready.bytes.toLocaleString()} bytes · The download is a copied snapshot; it won’t change the original.</DialogDescription>
          : file?.error ? <DialogDescription>{file.error}</DialogDescription>
          : <DialogDescription>Preparing a bounded browser preview.</DialogDescription>}
      </DialogHeader>
      {approval && <code className="max-h-32 overflow-auto rounded-lg bg-fill p-3 text-sm break-all">{approval.path}</code>}
      {file?.busy && <div role="status" className="flex min-h-32 items-center justify-center"><Spinner /> <span className="sr-only">Opening file</span></div>}
      {!file?.busy && (ready?.kind === "text" || ready?.kind === "markdown") && preview === undefined && !previewError && <div role="status" className="flex min-h-32 items-center justify-center"><Spinner /> <span className="sr-only">Loading preview</span></div>}
      {previewError && <p role="alert" className="text-sm text-destructive">{previewError}</p>}
      {!file.busy && ready?.kind === "image" && ready.previewUrl && <div className="min-h-0 overflow-auto rounded-lg bg-fill p-2"><img src={ready.previewUrl} alt={ready.name} className="mx-auto max-h-[60dvh] max-w-full object-contain" onError={event => { event.currentTarget.hidden = true; setPreviewError("Preview expired or is unavailable. Open the file link again."); }} /></div>}
      {!file.busy && ready?.kind === "text" && preview !== undefined && <pre className="min-h-0 overflow-auto rounded-lg bg-fill p-4 whitespace-pre-wrap break-words">{preview}</pre>}
      {!file.busy && ready?.kind === "markdown" && preview !== undefined && <div className="min-h-0 overflow-auto rounded-lg border p-4"><Markdown text={preview} className="prose-chat" /></div>}
      {downloadError && <p role="alert" className="text-sm text-destructive">{downloadError}</p>}
      <DialogFooter className="shrink-0">
        <Button variant="outline" onClick={onClose}>Close</Button>
        {approval && <Button disabled={file.busy} onClick={() => onApprove(file.href, approval)}><ExternalLinkIcon data-icon="inline-start" />Allow this file</Button>}
        {ready && <Button disabled={downloading} onClick={() => void downloadCopy()}>{downloading ? <Spinner /> : <DownloadIcon data-icon="inline-start" />}Download a copy</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
