import type { ThinkingLevel } from "../../../shared/wire.ts";
import { call, type RequestOptions } from "../../../web/src/shared/transport/api.ts";
import { modelEndpoints } from "../contracts/http.ts";

export const saveDefaults = async (
  model: string | undefined,
  thinkingLevel: ThinkingLevel,
  options?: RequestOptions,
): Promise<void> => {
  await call(modelEndpoints.saveDefaults, { body: { model, thinkingLevel } }, options);
};
