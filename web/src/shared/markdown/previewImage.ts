import {
  type FilePreview,
  previewKindByName,
} from "../../../../shared/features/workspace/files/files.ts";

export function previewImageBytes(
  preview: FilePreview,
): { mime: string; bytes: Uint8Array } | undefined {
  if (preview.kind === "svg")
    return { mime: "image/svg+xml", bytes: new TextEncoder().encode(preview.content) };
  if (preview.kind === "image") return { mime: preview.mime, bytes: preview.bytes };
  return undefined;
}

export function previewImage(preview: FilePreview): Blob | undefined {
  const image = previewImageBytes(preview);
  return image && new Blob([new Uint8Array(image.bytes)], { type: image.mime });
}

export function mayPreviewAsImage(path: string): boolean {
  const kind = previewKindByName(path);
  return kind === undefined || kind === "image" || kind === "svg";
}
