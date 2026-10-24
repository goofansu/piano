import { childEnvironment } from "./ChildEnvironment.ts";

/** Clear inherited Git selection/config/index/object overrides so the requested checkout wins.
 * Keep normal user config discovery and the rest of the child environment (including Worktrunk
 * settings).
 * Read-only Git hardening belongs to GitCheckout, not to lifecycle mutations.
 */
export function gitEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(childEnvironment()).filter(([key]) => !key.startsWith("GIT_")),
  );
}
