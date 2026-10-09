/** Machine-wide Radius onboarding, not an MCP client. Pi owns auth, configuration
 * parsing and package installation. Nothing here mutates running sessions. */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultPackageManager, type McpServerConfig, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
// Pi 1.1.0 has no public provider-auth configuration writer. Keep this pinned
// compatibility dependency here; RadiusSetup tests exercise the installed helper.
// Do not reproduce Pi's config loader or move configuration into Registry (INV-01/12).
import { addMcpServerConfig, loadMcpConfig } from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js";
import type { RadiusSetupState, RadiusSetupStep } from "../shared/radius.ts";
import { agentDir } from "./PiEnv.ts";

const RADIUS_MCP_URL = "https://radius.pi.dev/mcp";
const PACKAGE = "npm:@earendil-works/pi-radius-web-search";
const isWebSearch = (source: string) => source === PACKAGE || source.startsWith(`${PACKAGE}@`);

/** No shell interpolation, arbitrary package input, installer output or credentials
 * cross the HTTP boundary. A disconnected browser does not cancel the install. */
function install(source: string, directory: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cli = fileURLToPath(new URL("./bundle/cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
    mkdirSync(directory, { recursive: true });
    const child = spawn(process.execPath, [cli, "install", source, "--no-approve"], {
      cwd: directory, env: { ...process.env, PI_CODING_AGENT_DIR: directory }, detached: true, stdio: "ignore",
    });
    const stop = () => {
      // This process group belongs only to this installer, including npm children.
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } }
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    child.once("error", () => { signal.removeEventListener("abort", stop); reject(new Error("Installation could not start.")); });
    child.once("close", code => {
      signal.removeEventListener("abort", stop);
      if (code === 0 && !signal.aborted) resolve();
      else reject(new Error("Installation did not complete."));
    });
  });
}

export const RadiusSetupEnvironment = Context.Reference<{
  directory: () => string;
  install: (source: string, directory: string, signal: AbortSignal) => Promise<void>;
}>("piano/RadiusSetupEnvironment", { defaultValue: () => ({ directory: agentDir, install }) });

export class RadiusSetupError extends Data.TaggedError("RadiusSetupError")<{ readonly detail: string }> {}
export class RadiusSetup extends Context.Service<RadiusSetup, {
  readonly state: Effect.Effect<RadiusSetupState>;
  readonly configureMcp: Effect.Effect<RadiusSetupState, RadiusSetupError>;
  readonly installWebSearch: Effect.Effect<RadiusSetupState, RadiusSetupError>;
}>()("piano/RadiusSetup") {}

export const RadiusSetupLive = Layer.effect(RadiusSetup, Effect.gen(function* () {
  const environment = yield* RadiusSetupEnvironment;
  let installation: RadiusSetupState["installation"] = { status: "idle" };
  let pending: { abort: AbortController; done: Promise<void> } | undefined;
  const directory = environment.directory();
  const settings = () => {
    const manager = SettingsManager.create(directory, directory, { projectTrusted: false });
    if (manager.drainErrors().length) throw new Error("Could not read Pi settings.");
    return manager;
  };
  const mcp = () => {
    const loaded = loadMcpConfig({ agentDir: directory, cwd: directory, projectTrusted: false });
    if (loaded.errors.length) throw new Error("Check Pi's global mcp.json before setting up Radius.");
    const matches = loaded.servers.filter(entry => "url" in entry.config && entry.config.url.replace(/\/+$/, "") === RADIUS_MCP_URL);
    if (matches.length > 1) throw new Error("Multiple Radius MCP entries exist. Choose one in Pi before continuing.");
    const entry = matches[0] ?? loaded.servers.find(entry => entry.name === "radius");
    if (entry && !("url" in entry.config && entry.config.url.replace(/\/+$/, "") === RADIUS_MCP_URL)) {
      throw new Error("An unrelated MCP server is named radius. Rename it in Pi before continuing.");
    }
    return entry;
  };
  const mcpStep = (): RadiusSetupStep => {
    try {
      const entry = mcp();
      if (settings().getGlobalSettings().extensions?.includes("-builtin:mcp") || entry?.config.enabled === false || entry?.config.exposure === "hidden") {
        return { status: "blocked", detail: "Radius MCP is disabled or hidden in Pi. Enable it in Pi before continuing." };
      }
      if (!entry) return { status: "missing" };
      const config = entry.config;
      const configured = "url" in config && config.auth?.provider === "radius" && !config.oauth
        && !Object.keys(config.headers ?? {}).some(key => key.toLowerCase() === "authorization");
      return { status: configured ? "ready" : "missing" };
    } catch {
      return { status: "blocked", detail: "Check Pi's global MCP configuration for invalid or conflicting entries before continuing." };
    }
  };
  const packageState = () => {
    const manager = settings();
    const packages = new DefaultPackageManager({ cwd: directory, agentDir: directory, settingsManager: manager });
    const matches = (manager.getGlobalSettings().packages ?? []).filter(pkg => isWebSearch(typeof pkg === "string" ? pkg : pkg.source));
    if (matches.length > 1) throw new Error("Multiple web-search package entries.");
    const entry = matches[0];
    if (!entry) return undefined;
    const source = typeof entry === "string" ? entry : entry.source;
    const path = packages.getInstalledPath(source, "user");
    let installed = false;
    if (path) {
      try { installed = JSON.parse(readFileSync(join(path, "package.json"), "utf8")).name === "@earendil-works/pi-radius-web-search"; }
      catch { /* Incomplete installation: offer repair, not a success label. */ }
    }
    return { source, filtered: typeof entry !== "string", installed };
  };
  const webSearchStep = (): RadiusSetupStep => {
    try {
      const entry = packageState();
      if (entry?.filtered) return { status: "blocked", detail: "This package has custom resource filters. Manage it with Pi to preserve your choices." };
      return { status: entry?.installed ? "ready" : "missing" };
    } catch { return { status: "blocked", detail: "Could not read Pi's package settings. Check them before installing." }; }
  };
  const snapshot = (): RadiusSetupState => ({ mcp: mcpStep(), webSearch: webSearchStep(), installation: { ...installation } });
  yield* Effect.addFinalizer(() => Effect.promise(async () => { pending?.abort.abort(); await pending?.done; }));
  return RadiusSetup.of({
    state: Effect.sync(snapshot),
    configureMcp: Effect.try({
      try: () => {
        const step = mcpStep();
        if (step.status === "blocked") throw new Error(step.detail);
        if (step.status !== "ready") {
          const existing = mcp();
          const config: McpServerConfig = { ...(existing?.config ?? {}), url: RADIUS_MCP_URL, auth: { provider: "radius" } };
          if ("url" in config) {
            delete config.oauth;
            if (config.headers) config.headers = Object.fromEntries(Object.entries(config.headers).filter(([key]) => key.toLowerCase() !== "authorization"));
          }
          // Synchronous read/merge/write: no await at which another Piano tab can
          // replace the entry. The Pi helper retains unrelated keys and indentation.
          addMcpServerConfig(join(directory, "mcp.json"), existing?.name ?? "radius", config);
        }
        const state = snapshot();
        if (state.mcp.status !== "ready") throw new Error("Configuration was not saved.");
        return state;
      },
      catch: () => new RadiusSetupError({ detail: "Could not configure Radius MCP. Check Pi's global configuration and file permissions, then refresh." }),
    }),
    installWebSearch: Effect.try({
      try: () => {
        // Claim before starting async work. Duplicate requests reattach, never install twice.
        if (pending) return snapshot();
        const step = webSearchStep();
        if (step.status === "blocked") throw new Error(step.detail);
        if (step.status === "ready") { installation = { status: "success" }; return snapshot(); }
        // A missing pinned package is repaired at its existing version, not upgraded.
        const source = packageState()?.source ?? PACKAGE;
        const abort = new AbortController();
        installation = { status: "running" };
        const timer = setTimeout(() => abort.abort(), 120_000);
        const done = (async () => {
          try {
            await Promise.resolve().then(() => environment.install(source, directory, abort.signal));
            if (abort.signal.aborted || webSearchStep().status !== "ready") throw new Error("Installation not verified.");
            installation = { status: "success" };
          } catch {
            installation = { status: "error", detail: "Installation did not complete. Check your network and Pi package settings, then retry." };
          } finally { clearTimeout(timer); pending = undefined; }
        })();
        pending = { abort, done };
        return snapshot();
      },
      catch: () => new RadiusSetupError({ detail: "Could not install web search. Check Pi's package settings, then refresh." }),
    }),
  });
}));
