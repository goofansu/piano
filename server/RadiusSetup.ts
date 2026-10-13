/** Machine-wide Radius onboarding, not an MCP client. Pi owns auth, configuration
 * parsing and package installation. Nothing here mutates running sessions; a change to
 * Pi's packages or MCP configuration invalidates every directory's model catalog and commands. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DefaultPackageManager,
  type McpServerConfig,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
import type { RadiusSetupRequest, RadiusSetupState, RadiusSetupStep } from "../shared/radius.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import {
  authOf,
  type McpCatalogEntry,
  McpConfigEntries,
  withProviderAuth,
} from "./McpConfigEntries.ts";
import { agentDir } from "./PiEnv.ts";
import { runAsync, SubprocessError } from "./Subprocess.ts";

const RADIUS_MCP: McpCatalogEntry = {
  id: "radius",
  name: "Radius",
  url: "https://radius.pi.dev/mcp",
};
const PACKAGE = "npm:@earendil-works/pi-radius-web-search";
const isWebSearch = (source: string) => source === PACKAGE || source.startsWith(`${PACKAGE}@`);
const removalKey = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** No shell interpolation, arbitrary package input, installer output or credentials
 * cross the HTTP boundary. A disconnected browser does not cancel the install. */
async function runPackage(
  action: "install" | "remove",
  source: string,
  directory: string,
  signal: AbortSignal,
): Promise<void> {
  const cli = fileURLToPath(
    new URL("./bundle/cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")),
  );
  mkdirSync(directory, { recursive: true });
  // Its own process group: cancellation also stops npm children.
  await runAsync(
    {
      command: process.execPath,
      args: [cli, action, source, "--no-approve"],
      cwd: directory,
      env: { ...process.env, PI_CODING_AGENT_DIR: directory },
      group: true,
    },
    signal,
  ).catch((error) => {
    throw new Error(
      error instanceof SubprocessError && error.reason === "start"
        ? "Installation could not start."
        : "Installation did not complete.",
    );
  });
}

export const RadiusSetupEnvironment = Context.Reference<{
  directory: () => string;
  install: (source: string, directory: string, signal: AbortSignal) => Promise<void>;
  uninstall: (source: string, directory: string, signal: AbortSignal) => Promise<void>;
}>("piano/RadiusSetupEnvironment", {
  defaultValue: () => ({
    directory: agentDir,
    install: (source, directory, signal) => runPackage("install", source, directory, signal),
    uninstall: (source, directory, signal) => runPackage("remove", source, directory, signal),
  }),
});

export class RadiusSetupError extends Data.TaggedError("RadiusSetupError")<{
  readonly detail: string;
}> {}
export class RadiusSetup extends Context.Service<
  RadiusSetup,
  {
    readonly state: Effect.Effect<RadiusSetupState>;
    readonly change: (
      request: RadiusSetupRequest,
    ) => Effect.Effect<RadiusSetupState, RadiusSetupError>;
  }
>()("piano/RadiusSetup") {}

export const RadiusSetupLive = Layer.effect(
  RadiusSetup,
  Effect.gen(function* () {
    const environment = yield* RadiusSetupEnvironment;
    const facts = yield* DirectoryFacts;
    const invalidate = () => Effect.runPromise(facts.invalidate);
    let installation: RadiusSetupState["installation"] = { status: "idle" };
    let pending:
      | {
          action: "install" | "uninstall";
          key?: string;
          abort: AbortController;
          done: Promise<void>;
        }
      | undefined;
    const directory = environment.directory();
    const entries = yield* McpConfigEntries(directory);
    const settings = () => {
      const manager = SettingsManager.create(directory, directory, { projectTrusted: false });
      if (manager.drainErrors().length) throw new Error("Could not read Pi settings.");
      return manager;
    };
    /** Radius's policy: Pi sends the `radius` provider token, never OAuth or a fixed Authorization header. */
    const configured = (config: McpServerConfig) => {
      const auth = authOf(config);
      return auth._tag === "provider" && auth.provider === "radius" && !auth.competing;
    };
    const mcpStep = (): RadiusSetupStep => {
      const observed = entries.observe(RADIUS_MCP);
      if (observed.status === "missing") return { status: "missing" };
      const identity = observed.removalKey ? { removalKey: observed.removalKey } : {};
      if (observed.status === "blocked")
        return { status: "blocked", ...identity, detail: observed.detail };
      return { status: configured(observed.entry.config) ? "ready" : "missing", ...identity };
    };
    const packageState = () => {
      const manager = settings();
      const packages = new DefaultPackageManager({
        cwd: directory,
        agentDir: directory,
        settingsManager: manager,
      });
      const matches = (manager.getGlobalSettings().packages ?? []).filter((pkg) =>
        isWebSearch(typeof pkg === "string" ? pkg : pkg.source),
      );
      if (matches.length > 1) throw new Error("Multiple web-search package entries.");
      const entry = matches[0];
      if (!entry) return undefined;
      const source = typeof entry === "string" ? entry : entry.source;
      const path = packages.getInstalledPath(source, "user");
      let installed = false;
      if (path) {
        try {
          installed =
            JSON.parse(readFileSync(join(path, "package.json"), "utf8")).name ===
            "@earendil-works/pi-radius-web-search";
        } catch {
          /* Incomplete installation: offer repair, not a success label. */
        }
      }
      return {
        source,
        filtered: typeof entry !== "string",
        installed,
        removalKey: removalKey(entry),
      };
    };
    const webSearchStep = (): RadiusSetupStep => {
      try {
        const entry = packageState();
        const identity = entry ? { removalKey: entry.removalKey } : {};
        if (entry?.filtered)
          return {
            status: "blocked",
            ...identity,
            detail:
              "This package has custom resource filters. Manage it with Pi to preserve your choices.",
          };
        return { status: entry?.installed ? "ready" : "missing", ...identity };
      } catch {
        return {
          status: "blocked",
          detail: "Could not read Pi's package settings. Check them before installing.",
        };
      }
    };
    const snapshot = (): RadiusSetupState => ({
      mcp: mcpStep(),
      webSearch: webSearchStep(),
      installation: { ...installation },
    });
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        pending?.abort.abort();
        await pending?.done;
      }),
    );
    const changePackage = (action: "install" | "uninstall", key?: string) =>
      Effect.try({
        try: () => {
          // Duplicate requests reattach; opposing operations must never race on disk.
          if (pending) {
            if (pending.action !== action || pending.key !== key)
              throw new Error("Package operation in progress.");
            return snapshot();
          }
          const entry = packageState();
          if (action === "uninstall") {
            if (!entry || !key || entry.removalKey !== key)
              throw new Error("Package changed since confirmation.");
          } else {
            const step = webSearchStep();
            if (step.status === "blocked") throw new Error(step.detail);
            if (step.status === "ready") {
              installation = { action, status: "success" };
              return snapshot();
            }
          }
          const source = entry?.source ?? PACKAGE;
          const abort = new AbortController();
          installation = { action, status: "running" };
          const timer = setTimeout(() => abort.abort(), 120_000);
          const done = (async () => {
            try {
              // Even a failed operation may have changed Pi's packages; invalidate before reporting either outcome.
              try {
                await Promise.resolve().then(() =>
                  environment[action](source, directory, abort.signal),
                );
              } finally {
                await invalidate();
              }
              const verified =
                action === "install" ? webSearchStep().status === "ready" : !packageState();
              if (abort.signal.aborted || !verified)
                throw new Error("Package operation not verified.");
              installation = { action, status: "success" };
            } catch {
              installation = {
                action,
                status: "error",
                detail: `${action === "install" ? "Installation" : "Uninstallation"} did not complete. Check your network and Pi package settings, then refresh before retrying.`,
              };
            } finally {
              clearTimeout(timer);
              pending = undefined;
            }
          })();
          pending = { action, key, abort, done };
          return snapshot();
        },
        catch: () =>
          new RadiusSetupError({
            detail:
              "Could not change the web-search package. Finish any operation in progress and refresh before retrying.",
          }),
      });
    const configureMcp = entries
      .save(RADIUS_MCP, (existing) =>
        existing && configured(existing.config)
          ? undefined
          : withProviderAuth(existing?.config, RADIUS_MCP.url, "radius"),
      )
      .pipe(
        Effect.map(snapshot),
        Effect.filterOrFail(
          (state) => state.mcp.status === "ready",
          () => undefined,
        ),
        Effect.mapError(
          () =>
            new RadiusSetupError({
              detail:
                "Could not configure Radius MCP. Check Pi's global configuration and file permissions, then refresh.",
            }),
        ),
      );
    const removeMcp = (key: string) =>
      entries.remove(RADIUS_MCP, key).pipe(
        Effect.map(snapshot),
        Effect.mapError(
          () =>
            new RadiusSetupError({
              detail:
                "Could not remove Radius MCP. Its configuration may have changed. Refresh and confirm again.",
            }),
        ),
      );
    return RadiusSetup.of({
      state: Effect.sync(snapshot),
      change: (request) => {
        switch (request.action) {
          case "configure-mcp":
            return configureMcp;
          case "install-web-search":
            return changePackage("install");
          case "remove-mcp":
            return removeMcp(request.removalKey);
          case "uninstall-web-search":
            return changePackage("uninstall", request.removalKey);
        }
      },
    });
  }),
);
