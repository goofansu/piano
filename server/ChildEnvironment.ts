/** The environment every child process of Piano starts from: Piano's own without the launch
 * variables (LAUNCH_ENV). A Piano started inside another session thus never hands that parent's
 * endpoint, preview owner or project instructions to Pi, Git, Worktrunk and its hooks, or gh;
 * a Pi launch gets only the values its own launch sets.
 */
import { LAUNCH_ENV } from "../shared/dispatch.ts";

export function childEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of LAUNCH_ENV) delete env[name];
  return env;
}
