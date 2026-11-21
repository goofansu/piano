import { LAUNCH_ENV } from "../../shared/session/dispatch.ts";

export function childEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of LAUNCH_ENV) delete env[name];
  return env;
}
