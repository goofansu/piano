import { modelEndpoints } from "../../../../shared/features/models/http.ts";
import type { ThinkingLevel } from "../../../../shared/wire.ts";
import { call, type RequestOptions } from "../../shared/transport/api.ts";

export const saveDefaults = async (
  model: string | undefined,
  thinkingLevel: ThinkingLevel,
  options?: RequestOptions,
): Promise<void> => {
  await call(modelEndpoints.saveDefaults, { body: { model, thinkingLevel } }, options);
};
