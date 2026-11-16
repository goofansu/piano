import type { SessionReference } from "../../shared/wire.ts";

export const sessionReference = (
  cwd: string,
  sessionId: string,
  extra: Partial<SessionReference> = {},
): SessionReference => ({
  cwd,
  sessionId,
  workspaceId: `ws:${cwd}`,
  branch: null,
  archived: false,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...extra,
});
