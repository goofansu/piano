import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileNotice } from "@/components/FileNotice";
import { workspaceFile } from "@/lib/api";
import { prepareHtmlPreview } from "@/lib/html-preview";
import { listenHtmlPreviewLinks, type HtmlPreviewDocument } from "@/lib/html-preview-bridge";
import { useMachineId } from "@/lib/useMachine";
import { useNavigation } from "@/lib/useNavigation";

type Props = { content: string; path: string; workspaceId: string; active: boolean };

/** A changed owner removes the old frame/listener at commit, before passive read cleanup. */
export default function FileHtml(props: Props) {
  return (
    <HtmlDocument key={JSON.stringify([props.workspaceId, props.path, props.content])} {...props} />
  );
}

function HtmlDocument({ content, path, workspaceId, active }: Props) {
  const { openFile } = useNavigation();
  const machineId = useMachineId();
  const frame = useRef<HTMLIFrameElement>(null);
  const [document, setDocument] = useState<HtmlPreviewDocument>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void prepareHtmlPreview(
      content,
      path,
      (resource, signal) => workspaceFile(workspaceId, resource, { signal, machineId }),
      controller.signal,
    ).then(
      (document) => {
        if (!controller.signal.aborted) setDocument(document);
      },
      () => {
        if (!controller.signal.aborted)
          setError("Could not preview this HTML file. Turn off Preview to read the source.");
      },
    );
    return () => controller.abort();
  }, [content, path, workspaceId, machineId]);
  useLayoutEffect(() => {
    if (!active || !document || !frame.current) return;
    return listenHtmlPreviewLinks(window, frame.current, document, (link) => {
      if (link.kind === "file") openFile(link.path, "surface");
      else window.open(link.url, "_blank", "noopener,noreferrer");
    });
  }, [active, document, openFile]);
  if (error) return <FileNotice>{error}</FileNotice>;
  if (document === undefined) return <FileNotice>Opening HTML…</FileNotice>;
  // shadcn has no document renderer. Only the fixed CSP-hashed click bridge may run.
  // NEVER add same-origin, forms, popups, downloads or navigation allowances.
  return (
    <iframe
      key={document.token}
      ref={frame}
      title="HTML preview"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={document.srcDoc}
      className="absolute inset-0 size-full border-0"
      // Like SVG image mode, document colors are independent of Piano's theme.
      style={{ backgroundColor: "white", colorScheme: "light" }}
    />
  );
}
