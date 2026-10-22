import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** A short-lived adapter client, never the app owner. A lost reply requires status, not replay. */
export function previewRequest(request: unknown, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../../scripts/preview.ts", import.meta.url))],
      {
        env: {
          HOME: process.env.HOME,
          PIANO_PREVIEW_CONFIG: process.env.PIANO_PREVIEW_CONFIG,
          PIANO_PREVIEW_STATE: process.env.PIANO_PREVIEW_STATE,
        },
        stdio: ["pipe", "pipe", "pipe"],
        signal,
        timeout: 120_000,
      },
    );
    let output = "";
    let error = "";
    // Decode across chunk boundaries, so a multi-byte character in app logs stays intact.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      if (output.length + data.length > 32_768) {
        child.kill();
        reject(new Error("Preview output exceeded 32 KiB. Read status before another start."));
        return;
      }
      output += data;
    });
    child.stderr.on("data", (data) => {
      error = (error + data).slice(-2000);
    });
    child.on("error", () =>
      reject(new Error("Preview observation interrupted. Read status before another start.")),
    );
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(output || error || "Preview helper exited; read status."));
      else resolve(output.trim());
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

export function registerPreview(pi: ExtensionAPI) {
  pi.registerTool(
    defineTool({
      name: "piano_preview",
      label: "Piano preview",
      promptSnippet: "Start, inspect or explicitly stop a managed app in this session's workspace",
      promptGuidelines: [
        "When asked to run an app for the user, inspect repository scripts/instructions and use piano_preview. It fixes cwd to this session's workspace. command[0] may be a bare name such as node or npx. Use strict 127.0.0.1 binding with {port} in argv or injected PORT; no silent port fallback. Pass only required app environment, never Piano credentials.",
        "If the workspace already has an app, start without command returns it. To run a different command or restart, pass replace with the exact current instanceId, only when the user asked for a restart or a change, or the current instance failed or never became ready.",
        "Report observed local readiness and a Markdown preview link; authenticated external browser access and hot reload are separate checks. A 403 at readiness usually means the framework rejects the preview hostname. Keep the app running after your reply. On interruption or uncertain completion read status before starting again. If the supervisor/configuration is unavailable, report the limitation; do not fall back to an unowned process.",
      ],
      description:
        "One managed app per canonical workspace, owned outside Pi/Piano by Linux user systemd. start chooses a supported free port and waits up to timeoutSeconds for an owned loopback HTTP listener that answers the preview hostname. When an app exists, start returns it (specChanged if the request differs) and launches nothing; replace with its exact instanceId stops it and launches this request, or the same launch when command is omitted. command is argv (no shell interpretation), with {port} substitution; PORT is injected; a bare command[0] resolves on the app's PATH. status reconciles saved intent and returns bounded startup logs, identities, cwd, selected port, local readiness and a URL from deployment configuration. stop requires the exact instanceId from start/status and explicit user authorization. Abort ends observation, not the app. Requires configured private exe.dev origin and a lingering user manager; see docs/live-previews.md.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("start"), Type.Literal("status"), Type.Literal("stop")]),
        command: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
        env: Type.Optional(Type.Record(Type.String(), Type.String())),
        readyPath: Type.Optional(Type.String()),
        timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
        instanceId: Type.Optional(Type.String()),
        replace: Type.Optional(Type.String()),
      }),
      async execute(_id, params, signal, _update, ctx) {
        const text = await previewRequest({ ...params, workspace: ctx.cwd }, signal);
        return { content: [{ type: "text", text }], details: JSON.parse(text) };
      },
    }),
  );
}
