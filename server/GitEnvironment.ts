/** Clear inherited Git selection/config/index/object overrides so the requested checkout wins.
 * Keep normal user config discovery and non-Git environment (including Worktrunk settings).
 * Read-only Git hardening belongs to GitCheckout, not to lifecycle mutations.
 */
export function gitEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
}
