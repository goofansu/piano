import { useEffect, useMemo, useState } from "react";
import { workspaceFile } from "@/lib/api";
import { markdownImages } from "@/lib/markdown";
import { mayPreviewAsImage, previewImage } from "@/lib/previewImage";

const empty: ReadonlyMap<string, string> = new Map();

/** Replies resolve from the workspace root; Markdown files resolve from their own directory. */
export const relativeToDocument = (document: string, path: string) =>
  path.startsWith("/") ? path : `${document.slice(0, document.lastIndexOf("/") + 1)}${path}`;

/** Optional, bounded image enhancement through the same policy as an explicit file preview.
 * Only mounted prose owns blobs; changing workspace/document or unmounting cancels and revokes. */
export function useMarkdownImages(
  workspaceId: string | undefined,
  text: string,
  document = "",
): ReadonlyMap<string, string> {
  // Streaming prose after an image must not refetch it or flash its fallback on every delta.
  // A name that claims a non-image format (`demo.mp4`, `spec.pdf`) is never fetched or counted.
  const paths = useMemo(
    () => JSON.stringify(markdownImages(text).filter(mayPreviewAsImage).slice(0, 8)),
    [text],
  );
  const [loaded, setLoaded] = useState<{
    workspaceId: string;
    document: string;
    paths: string;
    images: ReadonlyMap<string, string>;
  }>();
  useEffect(() => {
    setLoaded(undefined);
    if (!workspaceId) return;
    const controller = new AbortController();
    const urls = new Map<string, string>();
    void (async () => {
      let total = 0;
      for (const path of JSON.parse(paths) as string[]) {
        if (controller.signal.aborted || total >= 20 * 1024 * 1024) break;
        try {
          const preview = await workspaceFile(workspaceId, relativeToDocument(document, path), {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          const image = previewImage(preview);
          if (!image) continue;
          total += image.size;
          if (total > 20 * 1024 * 1024) break;
          urls.set(path, URL.createObjectURL(image));
          setLoaded({ workspaceId, document, paths, images: new Map(urls) });
        } catch {
          // Keep the local-file action usable for an explicit retry/error.
        }
      }
    })();
    return () => {
      controller.abort();
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, [workspaceId, document, paths]);
  // Never show an old workspace's blobs, even for the render before effect cleanup.
  return loaded?.workspaceId === workspaceId &&
    loaded?.document === document &&
    loaded?.paths === paths
    ? loaded.images
    : empty;
}
