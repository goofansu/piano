import type { FilePreview } from "../../../shared/files.ts";
import { mayPreviewAsImage, previewImage } from "./previewImage.ts";

/** Distinct local images one prose surface may read, and the image bytes it may retain. */
export const markdownImageLimit = 8;
export const markdownImageBytes = 20 * 1024 * 1024;

/** Replies resolve from the workspace root; Markdown files resolve from their own directory. */
export const relativeToDocument = (document: string, path: string) =>
  path.startsWith("/") ? path : `${document.slice(0, document.lastIndexOf("/") + 1)}${path}`;

export interface MarkdownImageIo {
  /** Reads a path as the document wrote it; the caller resolves it against its document. */
  readonly read: (path: string, signal: AbortSignal) => Promise<FilePreview>;
  readonly createUrl: (blob: Blob) => string;
  readonly revokeUrl: (url: string) => void;
}

export interface MarkdownImageLoader {
  /** The image paths the prose references now, in document order. */
  readonly show: (paths: readonly string[]) => void;
  readonly images: () => ReadonlyMap<string, string>;
  readonly subscribe: (listener: (images: ReadonlyMap<string, string>) => void) => () => void;
  /** Aborts the read in flight and revokes every Blob URL. */
  readonly dispose: () => void;
}

/**
 * Loads the images of one prose surface for one (workspace, document) owner. Each path is read
 * at most once, one after another, within the image and byte budgets, so prose that grows (a
 * streaming reply) loads only its new images and never refetches or flashes earlier ones.
 * A name that claims a non-image format (`demo.mp4`, `spec.pdf`) is never read or counted;
 * an unreadable or non-image file keeps its fallback link.
 */
export function markdownImageLoader(io: MarkdownImageIo): MarkdownImageLoader {
  // A path that leaves the prose keeps its entry until dispose, so it never reloads if it returns.
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
      } catch {
        // Keep the local-file action usable for an explicit retry/error.
      }
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
