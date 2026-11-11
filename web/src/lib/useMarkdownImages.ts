import { useEffect, useMemo, useState } from "react";
import { workspaceFile } from "@/lib/api";
import { relativeToDocument } from "@/lib/file-link";
import { markdownImages } from "@/lib/markdown";
import { type MarkdownImageLoader, markdownImageLoader } from "@/lib/markdownImageLoader";
import { useMachineId } from "@/lib/useMachine";

const empty: ReadonlyMap<string, string> = new Map();

/** Optional, bounded image enhancement through the same policy as an explicit file preview.
 * Only mounted prose owns blobs; changing workspace/document or unmounting cancels and revokes. */
export function useMarkdownImages(
  workspaceId: string | undefined,
  text: string,
  document = "",
): ReadonlyMap<string, string> {
  const machineId = useMachineId();
  const paths = useMemo(() => markdownImages(text), [text]);
  const [owner, setOwner] = useState<{
    workspaceId: string;
    document: string;
    loader: MarkdownImageLoader;
    images: ReadonlyMap<string, string>;
  }>();
  useEffect(() => {
    if (!workspaceId) return;
    const loader = markdownImageLoader({
      read: (path, signal) =>
        workspaceFile(workspaceId, relativeToDocument(document, path), { signal, machineId }),
      createUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url),
    });
    const own = (images: ReadonlyMap<string, string>) =>
      setOwner({ workspaceId, document, loader, images });
    own(empty);
    const unsubscribe = loader.subscribe(own);
    return () => {
      unsubscribe();
      loader.dispose();
    };
  }, [workspaceId, document, machineId]);
  // Never show an old workspace's blobs, even for the render before effect cleanup.
  const current =
    owner?.workspaceId === workspaceId && owner?.document === document ? owner : undefined;
  const loader = current?.loader;
  // Streaming prose feeds every delta; the loader reads only paths it has not seen.
  useEffect(() => loader?.show(paths), [loader, paths]);
  return current?.images ?? empty;
}
