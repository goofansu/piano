/** Real-CLI fixture extension: Pi's supported session-control calls, never loaded by production. */
import { appendFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const record = (event: string, ctx: ExtensionCommandContext, extra: Record<string, unknown>) => {
  const file = process.env.PIANO_PHASE0_LOG;
  if (!file) throw new Error("The replacement extension requires isolated fixture storage");
  appendFileSync(file, `${JSON.stringify({ event, pid: process.pid, cwd: ctx.cwd, ...extra })}\n`);
};

export default function (pi: ExtensionAPI) {
  pi.registerCommand("review-switch-session", {
    description: "Fixture: switch this process to another session file",
    handler: async (args, ctx) => {
      const { cancelled } = await ctx.switchSession(args.trim());
      if (cancelled) record("replacement", ctx, { command: "switch", cancelled });
    },
  });
  pi.registerCommand("review-new-session", {
    description: "Fixture: replace this session with a new one",
    handler: async (_args, ctx) => {
      const { cancelled } = await ctx.newSession();
      if (cancelled) record("replacement", ctx, { command: "new", cancelled });
    },
  });
  pi.registerCommand("review-fork", {
    description: "Fixture: fork this session at an entry",
    handler: async (args, ctx) => {
      const { cancelled } = await ctx.fork(args.trim(), { position: "at" });
      if (cancelled) record("replacement", ctx, { command: "fork", cancelled });
    },
  });
  pi.registerCommand("review-record", {
    description: "Fixture: record which session this process holds",
    handler: async (_args, ctx) => {
      record("identity", ctx, {
        sessionId: ctx.sessionManager.getSessionId(),
        sessionFile: ctx.sessionManager.getSessionFile(),
      });
    },
  });
}
