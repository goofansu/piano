import { childEnvironment } from "./ChildEnvironment.ts";

export function gitEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(childEnvironment()).filter(([key]) => !key.startsWith("GIT_")),
  );
}
