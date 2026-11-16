import { StringEnum } from "@earendil-works/pi-ai";
import { arr, map, num, obj, opt, type Static, str } from "@earendil-works/pi-schema";
import { START_TIMEOUT_SECONDS } from "./PreviewReadiness.ts";

export const PreviewParameters = obj({
  action: StringEnum(["start", "status", "stop"] as const),
  command: opt(arr(str(), { minItems: 1 })),
  env: opt(map(str())),
  readyPath: opt(str()),
  timeoutSeconds: opt(
    num({ minimum: START_TIMEOUT_SECONDS.min, maximum: START_TIMEOUT_SECONDS.max }),
  ),
  instanceId: opt(str()),
  replace: opt(str()),
});

export type PreviewArguments = Static<typeof PreviewParameters>;
export type PreviewRequest = PreviewArguments & { workspace: string };
