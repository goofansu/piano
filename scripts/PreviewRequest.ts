import { StringEnum } from "@earendil-works/pi-ai";
import { arr, map, num, obj, opt, type Static, str } from "@earendil-works/pi-schema";
import { START_TIMEOUT_SECONDS } from "./PreviewReadiness.ts";

/** The `piano_preview` tool's arguments: Pi validates them, so this is their only declaration. */
export const PreviewParameters = obj({
  action: StringEnum(["start", "status", "stop"] as const),
  command: opt(arr(str(), { minItems: 1 })),
  env: opt(map(str())),
  readyPath: opt(str()),
  timeoutSeconds: opt(
    num({ minimum: START_TIMEOUT_SECONDS.min, maximum: START_TIMEOUT_SECONDS.max }),
  ),
  instanceId: opt(str()),
  /** The exact current instanceId to stop and launch again, with this request's launch. */
  replace: opt(str()),
});

/** What the tool sends to the owner. */
export type PreviewArguments = Static<typeof PreviewParameters>;
/** The tool's arguments plus the workspace the trusted owner fixes. */
export type PreviewRequest = PreviewArguments & { workspace: string };
