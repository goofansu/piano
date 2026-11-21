import type { FilePreview } from "../../../../shared/workspace/files.ts";
import { mayPreviewAsImage, previewImage } from "./previewImage.ts";

export const markdownImageLimit = 8;
export const markdownImageBytes = 20 * 1024 * 1024;

export interface MarkdownImageIo {
  readonly read: (path: string, signal: AbortSignal) => Promise<FilePreview>;
  readonly createUrl: (blob: Blob) => string;
  readonly revokeUrl: (url: string) => void;
}

export interface MarkdownImageLoader {
  readonly show: (paths: readonly string[]) => void;
  readonly images: () => ReadonlyMap<string, string>;
  readonly subscribe: (listener: (images: ReadonlyMap<string, string>) => void) => () => void;
  readonly dispose: () => void;
}

export function markdownImageLoader(io: MarkdownImageIo): MarkdownImageLoader {
  const admitted = new Set<string>();
  const queue: string[] = [];
  const urls = new Map<string, string>();
  const listeners = new Set<(images: ReadonlyMap<string, string>) => void>();
  const controller = new AbortController();
  let images: ReadonlyMap<string, string> = new Map();
  let total = 0;
  let loading = false;

  const pump = async () => {
    loading = true;
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      if (controller.signal.aborted || total >= markdownImageBytes) break;
      try {
        const preview = await io.read(path, controller.signal);
        if (controller.signal.aborted) break;
        const image = previewImage(preview);
        if (!image) continue;
        total += image.size;
        if (total > markdownImageBytes) break;
        urls.set(path, io.createUrl(image));
        images = new Map(urls);
        for (const listener of listeners) listener(images);
      } catch {}
    }
    loading = false;
  };

  return {
    show: (paths) => {
      for (const path of paths) {
        if (admitted.size >= markdownImageLimit) break;
        if (admitted.has(path) || !mayPreviewAsImage(path)) continue;
        admitted.add(path);
        queue.push(path);
      }
      if (!loading && queue.length > 0 && !controller.signal.aborted) void pump();
    },
    images: () => images,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      controller.abort();
      queue.length = 0;
      listeners.clear();
      for (const url of urls.values()) io.revokeUrl(url);
      urls.clear();
    },
  };
}
