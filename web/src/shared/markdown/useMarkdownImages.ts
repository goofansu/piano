import { useEffect, useMemo, useState } from "react";
import { createContext, useContext } from "react";
import type { FilePreview } from "../../../../shared/workspace/files.ts";
import type { RequestOptions } from "../transport/api.ts";
export const MarkdownFileReader = createContext<
  ((workspaceId: string, path: string, options: RequestOptions) => Promise<FilePreview>) | null
>(null);
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
  const readFile = useContext(MarkdownFileReader);
  const paths = useMemo(() => (workspaceId ? markdownImages(text) : []), [workspaceId, text]);
  const [owner, setOwner] = useState<{
    workspaceId: string;
    document: string;
    loader: MarkdownImageLoader;
    images: ReadonlyMap<string, string>;
  }>();
  useEffect(() => {
    if (!workspaceId || !readFile) return;
    const loader = markdownImageLoader({
      read: (path, signal) => readFile(workspaceId, relativeToDocument(document, path), { signal }),
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
  }, [readFile, workspaceId, document]);
  const current =
    owner?.workspaceId === workspaceId && owner?.document === document ? owner : undefined;
  const loader = current?.loader;
  useEffect(() => loader?.show(paths), [loader, paths]);
  return current?.images ?? empty;
}
