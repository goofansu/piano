import { sessionKey } from "../../../../shared/wire.ts";
export type DraftKey = string & { readonly __draft: unique symbol };

export const NEW_SESSION_DRAFT = "new-session" as DraftKey;
export const sessionDraftKey = (s: { cwd: string; sessionId: string | null }) =>
  sessionKey(s.cwd, s.sessionId ?? "") as DraftKey;
