import { registerHooks } from "node:module";
import { workerData } from "node:worker_threads";

const mode = workerData.historySdkMode as string;
registerHooks({
  load(url, context, nextLoad) {
    if (mode === "narrow" && url.endsWith("/@earendil-works/pi-coding-agent/dist/index.js"))
      throw new Error("Read-only history must not initialize the public SDK root");
    return nextLoad(url, context);
  },
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.endsWith("/server/PiHistoryFile.ts") &&
      specifier.endsWith("/core/session-manager.js")
    ) {
      if (mode === "missing" || mode === "dependency")
        throw Object.assign(new Error("Missing SDK module"), {
          code: "ERR_MODULE_NOT_FOUND",
          url: mode === "missing" ? specifier : "file:///missing-transitive-dependency.js",
        });
      const source =
        mode === "exports"
          ? "export const SessionManager = {};"
          : mode === "initialization"
            ? 'throw new Error("SDK initialization failed");'
            : undefined;
      if (source)
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
