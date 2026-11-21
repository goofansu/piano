import { useEffect, useMemo, useState } from "react";
import { workspaceFile } from "@/features/workspace/files/fileApi";
import { relativeToDocument } from "@/shared/markdown/file-link";
import {
  type MarkdownImageLoader,
  markdownImageLoader,
} from "@/shared/markdown/markdownImageLoader";
import { markdownImages } from "@/shared/markdown/markdownPlugins";

const empty: ReadonlyMap<string, string> = new Map();

export function useMarkdownImages(
  workspaceId: string | undefined,
  text: string,
  document = "",
): ReadonlyMap<string, string> {
  const paths = useMemo(() => (workspaceId ? markdownImages(text) : []), [workspaceId, text]);
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
        workspaceFile(workspaceId, relativeToDocument(document, path), { signal }),
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
  }, [workspaceId, document]);
  const current =
    owner?.workspaceId === workspaceId && owner?.document === document ? owner : undefined;
  const loader = current?.loader;
  useEffect(() => loader?.show(paths), [loader, paths]);
  return current?.images ?? empty;
}
