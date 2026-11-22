import { fileURLToPath } from "node:url";
import { basePiCli } from "../../features/sessions/server/index.ts";

export const defaultPiCli = () => ({
  ...basePiCli(),
  extensions: [
    fileURLToPath(
      new URL("../../features/sessions/extension/piano-session/index.ts", import.meta.url),
    ),
    fileURLToPath(new URL("../../features/projects/extension/index.ts", import.meta.url)),
    fileURLToPath(new URL("../../features/dispatch/extension/index.ts", import.meta.url)),
    fileURLToPath(
      new URL("../../features/sessions/extension/piano-ask-user/index.ts", import.meta.url),
    ),
    fileURLToPath(new URL("../../features/library/extension/index.ts", import.meta.url)),
    fileURLToPath(new URL("../../features/radius/extension/index.ts", import.meta.url)),
  ],
});
