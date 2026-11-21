import { radiusEndpoints } from "../../../../shared/features/radius/http.ts";
import type { RadiusSetupAction } from "../../../../shared/features/radius/radius.ts";
import { call, type RequestOptions } from "../../shared/transport/api.ts";

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
