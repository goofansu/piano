import { useEffect, useState } from "react";
import { FileNotice } from "@/components/FileNotice";
import { workspaceFile } from "@/lib/api";
import { prepareHtmlPreview } from "@/lib/html-preview";

/** Documents get no origin privileges or script bridge into Piano. */
export default function FileHtml({
  content,
  path,
  workspaceId,
}: {
  content: string;
  path: string;
  workspaceId: string;
}) {
  const [document, setDocument] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setDocument(undefined);
    setError(undefined);
    void prepareHtmlPreview(
      content,
      path,
      (resource, signal) => workspaceFile(workspaceId, resource, { signal }),
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
  }, [content, path, workspaceId]);
  if (error) return <FileNotice>{error}</FileNotice>;
  if (document === undefined) return <FileNotice>Opening HTML…</FileNotice>;
  // shadcn has no document renderer. The empty sandbox is intentional: never add
  // allow-scripts, allow-same-origin, forms, popups or navigation privileges.
  return (
    <iframe
      title="HTML preview"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={document}
      className="absolute inset-0 size-full border-0"
      // Like SVG image mode, document colors are independent of Piano's theme.
      style={{ backgroundColor: "white", colorScheme: "light" }}
    />
  );
}
