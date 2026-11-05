/** The bundled radius-artifacts extension's publication contract: versioned confirmation
 * receipts, tool names and results. Piano reads receipts independently of tool output, with
 * direct results retained for legacy sessions. */
import { arr, int, num, obj, opt, type Schema, type Static, str } from "@earendil-works/pi-schema";
import { z } from "zod";

/** Written only after the extension verifies the publication, never for an intent or view. */
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

/** Latest confirmed revision per identity, newest publication first. Reconciliation of an old
 * operation must not replace a newer title or reorder the list. */
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

export const RADIUS_ARTIFACT_CREATE_TOOL = "radius_artifact_create";
export const RADIUS_ARTIFACT_UPDATE_TOOL = "radius_artifact_update";
export const RADIUS_ARTIFACT_VIEW_TOOL = "radius_artifact_view";

/** The tools that publish: a confirmed result from one of them is an artifact the session made. */
const PUBLISHING_TOOLS: ReadonlySet<string> = new Set([
  RADIUS_ARTIFACT_CREATE_TOOL,
  RADIUS_ARTIFACT_UPDATE_TOOL,
]);

/** `confirmed` is the only status that means Radius holds the publication. */
const status: Schema<"confirmed" | "unknown" | "error"> = {
  // `type` with `enum`, as pi-ai's StringEnum emits, for providers without anyOf/const support.
  type: "string",
  enum: ["confirmed", "unknown", "error"],
};

/** Every radius-artifacts tool's result, as Pi stores it as JSON text and structured content. */
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
});
export type RadiusArtifactResult = Static<typeof RadiusArtifactResult>;

/** Whether `toolName` is a radius-artifacts tool that publishes (create or update). */
export const isPublishingTool = (toolName: string) => PUBLISHING_TOOLS.has(toolName);

/** The artifact a publishing tool's result text confirms, else undefined: a view, a failed or
 * unconfirmed publication, or text that is not such a result publishes nothing. */
export function publishedArtifact(
  toolName: string,
  resultText: string,
): { readonly id: string; readonly url: string } | undefined {
  if (!isPublishingTool(toolName)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(resultText);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = value as Partial<Record<keyof RadiusArtifactResult, unknown>>;
  const { status, artifactId, url } = result;
  return status === "confirmed" &&
    typeof artifactId === "string" &&
    artifactId &&
    typeof url === "string" &&
    url
    ? { id: artifactId, url }
    : undefined;
}
