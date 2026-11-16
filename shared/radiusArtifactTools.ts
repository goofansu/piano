import type { RadiusArtifactResult } from "./radiusArtifacts.ts";

export const RADIUS_ARTIFACT_CREATE_TOOL = "radius_artifact_create";
export const RADIUS_ARTIFACT_UPDATE_TOOL = "radius_artifact_update";
export const RADIUS_ARTIFACT_VIEW_TOOL = "radius_artifact_view";

const PUBLISHING_TOOLS: ReadonlySet<string> = new Set([
  RADIUS_ARTIFACT_CREATE_TOOL,
  RADIUS_ARTIFACT_UPDATE_TOOL,
]);

export const isPublishingTool = (toolName: string) => PUBLISHING_TOOLS.has(toolName);

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
