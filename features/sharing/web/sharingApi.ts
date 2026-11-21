import { call, type RequestOptions } from "../../../web/src/shared/transport/api.ts";
import { sharingEndpoints } from "../contracts/share.ts";

export const shareSession = (workspaceId: string, sessionId: string, options?: RequestOptions) =>
  call(
    sharingEndpoints.shareSession,
    { query: { workspaceId, sessionId }, body: { confirmed: true } },
    options,
  );
