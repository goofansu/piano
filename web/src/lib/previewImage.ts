import { type FilePreview, previewKindByName } from "../../../shared/files.ts";

/**
 * The bytes an `<img>` shows for a preview, with their type: raster bytes, or SVG text encoded as
 * an image (never inline SVG, so its scripts and external resources stay off). Every other kind
 * is not an image. A file's tab, the images in Markdown and the images in an HTML preview all
 * read this, so they agree on what is an image.
 */
export function previewImageBytes(
  preview: FilePreview,
): { mime: string; bytes: Uint8Array } | undefined {
  if (preview.kind === "svg")
    return { mime: "image/svg+xml", bytes: new TextEncoder().encode(preview.content) };
  if (preview.kind === "image") return { mime: preview.mime, bytes: preview.bytes };
  return undefined;
}

/** {@link previewImageBytes} as a Blob, for an `<img>` that shows it through a Blob URL. */
export function previewImage(preview: FilePreview): Blob | undefined {
  const image = previewImageBytes(preview);
  return image && new Blob([new Uint8Array(image.bytes)], { type: image.mime });
}

/** Whether a file of this name may preview as an image: its name claims an image, or claims
 * nothing, since the server recognizes an image without an extension by its bytes. */
export function mayPreviewAsImage(path: string): boolean {
  const kind = previewKindByName(path);
  return kind === undefined || kind === "image" || kind === "svg";
}
