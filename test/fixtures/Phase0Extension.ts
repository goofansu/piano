/** Discovered user extension for the real-CLI checkpoint, never loaded by production. */
import { appendFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const record = (event: string, ctx: ExtensionContext, extra: Record<string, unknown> = {}) => {
  const file = process.env.PIANO_PHASE0_LOG;
  if (!file) throw new Error("Phase 0 extension requires isolated fixture storage");
  appendFileSync(file, `${JSON.stringify({ event, pid: process.pid, cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId(), ...extra })}\n`);
};

export default function (pi: ExtensionAPI) {
  pi.registerFlag("phase0-startup-dialog", { description: "Checkpoint only: reproduce an awaited startup dialog", type: "boolean", default: false });
  pi.registerFlag("phase0-startup-keepalive", { description: "Checkpoint only: keep an extension handle alive during startup", type: "boolean", default: false });
  pi.on("cache_warming_decision", () => ({ action: "stop" }));
  pi.on("session_start", async (_event, ctx) => {
    record("session-start", ctx);
    if (pi.getFlag("phase0-startup-dialog")) {
      record("startup-dialog", ctx, { keepAlive: !!pi.getFlag("phase0-startup-keepalive") });
      // A real extension may own a watcher/socket. Without any live handle, Node can exit
      // rather than hang on an unresolved startup promise. Exercise both outcomes.
      const timer = pi.getFlag("phase0-startup-keepalive") ? setInterval(() => {}, 1000) : undefined;
      try { await ctx.ui.input("Phase 0 startup dialog"); }
      finally { if (timer) clearInterval(timer); }
      record("startup-dialog-returned", ctx);
    }
  });
  pi.on("session_shutdown", (_event, ctx) => { record("session-shutdown", ctx); });
  pi.registerCommand("phase0-facts", {
    description: "Report Pi-owned resource/configuration facts without a model call",
    handler: async (_args, ctx) => {
      const facts = {
        cwd: ctx.cwd, trusted: ctx.isProjectTrusted(), model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
        effort: pi.getThinkingLevel(), tools: pi.getAllTools().map(tool => tool.name),
        commands: pi.getCommands().map(command => command.name), cacheWarming: pi.getSettings().cacheWarming,
      };
      record("facts", ctx, facts);
      ctx.ui.notify(`PHASE0_FACTS ${JSON.stringify(facts)}`);
    },
  });
  pi.registerCommand("phase0-dialog", {
    description: "Supported command-triggered RPC input dialog",
    handler: async (_args, ctx) => {
      record("command-dialog", ctx);
      const value = await ctx.ui.input("Phase 0 supported dialog", "Enter checkpoint text");
      record("command-dialog-returned", ctx, { value: value ?? null });
      ctx.ui.notify(`PHASE0_DIALOG_RESULT ${value ?? "cancelled"}`);
    },
  });
  pi.registerCommand("phase2-timeout", {
    description: "Supported timed dialog for the Phase 2 browser check",
    handler: async (_args, ctx) => {
      record("timed-dialog", ctx);
      const value = await ctx.ui.input("Phase 2 timed dialog", "Expires in 12 seconds", { timeout: 12_000 });
      record("timed-dialog-returned", ctx, { value: value ?? null });
      ctx.ui.notify(`PHASE2_TIMEOUT_RESULT ${value ?? "cancelled"}`);
    },
  });
  pi.registerCommand("phase0-wait", {
    description: "Start one local synthetic stream that waits for native abort",
    handler: async (_args, ctx) => {
      record("wait-command", ctx);
      pi.sendUserMessage("PHASE0_WAIT");
    },
  });
  pi.registerCommand("phase0-exit", {
    description: "Request explicit CLI shutdown",
    handler: async (_args, ctx) => {
      record("exit-command", ctx);
      ctx.ui.notify("PHASE0_EXIT_REQUESTED");
      ctx.shutdown();
    },
  });
}
