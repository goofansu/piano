/** The bundled radius-artifacts extension's publication contract as Piano reads it from Pi's
 * records: its tool names and the result each call returns. The extension registers its tools and
 * shapes its results from here; the session header's Artifacts menu reads a confirmed publication
 * through `publishedArtifact`, so renaming a tool or a result field cannot silently empty it. */
import { arr, int, num, obj, opt, type Schema, type Static, str } from "@earendil-works/pi-schema";

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
