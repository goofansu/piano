import { sharingEndpoints } from "../../../../shared/features/sharing/share.ts";
import { call, type RequestOptions } from "../../shared/transport/api.ts";

export const shareSession = (workspaceId: string, sessionId: string, options?: RequestOptions) =>
  call(
    sharingEndpoints.shareSession,
    { query: { workspaceId, sessionId }, body: { confirmed: true } },
    options,
  );
