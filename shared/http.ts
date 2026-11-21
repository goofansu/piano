import { libraryEndpoints } from "./features/library/http.ts";
import { mcpEndpoints } from "./features/mcp/http.ts";
import { modelEndpoints } from "./features/models/http.ts";
import { providerEndpoints } from "./features/providers/http.ts";
import { radiusEndpoints } from "./features/radius/http.ts";
import { composerEndpoints } from "./features/sessions/composer/http.ts";
import { sharingEndpoints } from "./features/sharing/share.ts";
import { voiceInputEndpoints } from "./features/voice-input/http.ts";
import { webhookEndpoints } from "./features/webhooks/http.ts";
import { changesEndpoints } from "./features/workspace/changes/http.ts";
import { fileEndpoints } from "./features/workspace/files/http.ts";
import { folderEndpoints } from "./features/workspace/folders/http.ts";
import { pullRequestEndpoints } from "./features/workspace/pull-requests/http.ts";

export const Endpoints = {
  ...folderEndpoints,
  ...fileEndpoints,
  ...changesEndpoints,
  ...sharingEndpoints,
  ...pullRequestEndpoints,
  ...composerEndpoints,
  ...webhookEndpoints,
  ...libraryEndpoints,
  ...modelEndpoints,
  ...radiusEndpoints,
  ...mcpEndpoints,
  ...voiceInputEndpoints,
  ...providerEndpoints,
} as const;

export type Endpoints = typeof Endpoints;
