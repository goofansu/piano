import { call, type RequestOptions } from "../../../web/src/shared/transport/api.ts";
import { radiusEndpoints } from "../contracts/http.ts";
import type { RadiusSetupAction } from "../contracts/radius.ts";

export const radiusSetup = async (
  action?: { action: RadiusSetupAction; removalKey?: string },
  options?: RequestOptions,
) =>
  (action
    ? await call(
        radiusEndpoints.changeRadiusSetup,
        { body: action as typeof radiusEndpoints.changeRadiusSetup.body.Type },
        options,
      )
    : await call(radiusEndpoints.radiusSetup, {}, options)
  ).state;
