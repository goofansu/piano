import { libraryEndpoints } from "../../features/library/contracts/http.ts";
import { mcpEndpoints } from "../../features/mcp/contracts/http.ts";
import { modelEndpoints } from "../../features/models/contracts/http.ts";
import { providerEndpoints } from "../../features/providers/contracts/http.ts";
import { radiusEndpoints } from "../../features/radius/contracts/http.ts";
import { composerEndpoints } from "../../features/sessions/contracts/composer/http.ts";
import { sharingEndpoints } from "../../features/sharing/contracts/share.ts";
import { voiceInputEndpoints } from "../../features/voice-input/contracts/http.ts";
import { webhookEndpoints } from "../../features/webhooks/contracts/http.ts";
import { changesEndpoints } from "../../features/workspace/contracts/changes/http.ts";
import { fileEndpoints } from "../../features/workspace/contracts/files/http.ts";
import { folderEndpoints } from "../../features/workspace/contracts/folders/http.ts";
import { pullRequestEndpoints } from "../../features/workspace/contracts/pull-requests/http.ts";

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
