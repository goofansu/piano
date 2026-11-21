import { LAUNCH_ENV } from "../../shared/features/dispatch/dispatch.ts";

export function childEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of LAUNCH_ENV) delete env[name];
  return env;
}
