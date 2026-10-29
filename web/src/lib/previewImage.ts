import { type FilePreview, previewKindByName } from "../../../shared/files.ts";

/**
 * What an `<img>` shows for a preview: raster bytes, or SVG text as an image Blob (never inline
 * SVG, so its scripts and external resources stay off). Every other kind is not an image.
 * A file's tab and the images in Markdown both read this, so they agree on what is an image.
 */
export function previewImage(preview: FilePreview): Blob | undefined {
  if (preview.kind === "svg") return new Blob([preview.content], { type: "image/svg+xml" });
  if (preview.kind === "image")
    return new Blob([new Uint8Array(preview.bytes)], { type: preview.mime });
  return undefined;
}

/** Whether a file of this name may preview as an image: its name claims an image, or claims
 * nothing, since the server recognizes an image without an extension by its bytes. */
export function mayPreviewAsImage(path: string): boolean {
  const kind = previewKindByName(path);
  return kind === undefined || kind === "image" || kind === "svg";
}
