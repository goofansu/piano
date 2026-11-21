import {
  arr,
  int,
  nullable,
  num,
  obj,
  opt,
  type Schema,
  type Static,
  str,
} from "@earendil-works/pi-schema";
import { z } from "zod";

export const RADIUS_ARTIFACT_FILE_BYTES = 25 * 1024 * 1024;
export const RADIUS_ARTIFACT_FILE_LIMIT = `${RADIUS_ARTIFACT_FILE_BYTES / 2 ** 20} MiB`;
export const RADIUS_ARTIFACT_PUBLICATION = "radius-artifact-publication-v1";
export const ArtifactPublication = z.object({
  artifactId: z.string().min(1),
  title: z.string().min(1).max(256),
  url: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    }),
  revision: z.number().int().positive(),
  operationKey: z.string().min(1).max(128),
});
export type ArtifactPublication = z.infer<typeof ArtifactPublication>;

export function artifactPublication(entry: unknown): ArtifactPublication | undefined {
  if (!entry || typeof entry !== "object") return;
  const { type, customType, data } = entry as Record<string, unknown>;
  if (type !== "custom" || customType !== RADIUS_ARTIFACT_PUBLICATION) return;
  const parsed = ArtifactPublication.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

export function withArtifactPublication(
  publications: readonly ArtifactPublication[],
  publication: ArtifactPublication,
): readonly ArtifactPublication[] {
  const previous = publications.find((p) => p.artifactId === publication.artifactId);
  if (previous && previous.revision >= publication.revision) return publications;
  return [publication, ...publications.filter((p) => p.artifactId !== publication.artifactId)];
}

export function artifactPublications(entries: readonly unknown[]): readonly ArtifactPublication[] {
  let publications: readonly ArtifactPublication[] = [];
  for (const entry of entries) {
    const publication = artifactPublication(entry);
    if (publication) publications = withArtifactPublication(publications, publication);
  }
  return publications;
}

export {
  RADIUS_ARTIFACT_CREATE_TOOL,
  RADIUS_ARTIFACT_UPDATE_TOOL,
  RADIUS_ARTIFACT_VIEW_TOOL,
  isPublishingTool,
  publishedArtifact,
} from "./artifactTools.ts";

const status: Schema<"confirmed" | "unknown" | "error"> = {
  type: "string",
  enum: ["confirmed", "unknown", "error"],
};

export const RadiusArtifactResult = obj({
  status,
  message: str(),
  artifactId: opt(str()),
  url: opt(str()),
  revision: opt(int()),
  latestRevision: opt(int()),
  visibility: opt(str()),
  expiresAt: opt(str()),
  files: opt(arr(obj({ path: str(), content_type: str(), stored_bytes: num() }))),
  content: opt(str()),
  path: opt(str()),
  offset: opt(int()),
  nextOffset: opt(nullable(int())),
  totalBytes: opt(int()),
});
export type RadiusArtifactResult = Static<typeof RadiusArtifactResult>;
