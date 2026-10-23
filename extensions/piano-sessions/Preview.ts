import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ownerRequest } from "../../scripts/PreviewClient.ts";

/** A short-lived observation client; the trusted server endpoint fixes workspace and owner. */
export function previewRequest(request: unknown, signal?: AbortSignal): Promise<string> {
  const endpoint = process.env.PIANO_PREVIEW_OWNER;
  if (!endpoint) return Promise.reject(new Error("Preview requires a live Piano session owner."));
  return ownerRequest(endpoint, request, signal);
}

/** How previews reach the browser here: a private exe.dev origin on Linux, localhost on a Mac. */
function previewHost(platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  if (platform === "darwin")
    return {
      supervisor: "the user's launchd session",
      access:
        "The link opens on this Mac, where readiness was observed; check hot reload separately.",
    };
  // Linux launches need the configured origin; without it every start would only fail.
  if (platform === "linux" && env.PIANO_PREVIEW_CONFIG)
    return {
      supervisor: "the lingering systemd user manager",
      access:
        "Authenticated external browser access and hot reload are separate checks. A 403 at readiness usually means the framework rejects the preview hostname; allow it (Vite: env __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS).",
    };
  return undefined;
}

/** Offered only to a live hosted generation on a supported executor. */
export function registerPreview(
  pi: ExtensionAPI,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  const host = previewHost(platform, env);
  if (!host || !env.PIANO_PREVIEW_OWNER) return;
  pi.registerTool(
    defineTool({
      name: "piano_preview",
      label: "Piano preview",
      promptSnippet: "Start, inspect or explicitly stop a managed app in this session's workspace",
      promptGuidelines: [
        "When asked to run an app for the user, inspect repository scripts/instructions and use piano_preview. It fixes cwd to this session's workspace. command[0] may be a bare name such as node or npx. Use strict 127.0.0.1 binding with {port} in argv or injected PORT; no silent port fallback. Pass only required app environment, never Piano credentials.",
        "If this Pi generation owns the workspace's app, start without command returns it. Another session's app is an ownership conflict, never reused or transferred. To run a different command or restart, pass replace with the exact current instanceId, only when the user asked for a restart or a change, or the current instance failed or never became ready.",
        `Report observed local readiness and a Markdown preview link. ${host.access} Keep the app running after your reply. On interruption or uncertain completion read status before starting again. If the supervisor/configuration is unavailable, report the limitation; do not fall back to an unowned process.`,
      ],
      description: `One managed app per canonical workspace, owned by this session's live Pi generation and executed by ${host.supervisor}. It survives turn completion, abort and browser disconnect, but stops when Pi ends (including archive/delete or Piano shutdown). Reopening never adopts or relaunches it. start chooses a supported free port and waits up to timeoutSeconds for an owned loopback HTTP listener that answers the preview hostname. When this generation owns an app, start returns it (specChanged if the request differs) and launches nothing; another session's app is an ownership conflict, even if failed; replace with its exact instanceId stops it and launches this request, or the same launch when command is omitted. command is argv (no shell interpretation), with {port} substitution; PORT is injected; a bare command[0] resolves on the app's PATH. status reconciles saved intent and returns state (starting, running, exited, failed, stopping or not-loaded), bounded startup logs, identities, cwd, selected port, local readiness and the preview URL. stop requires the exact instanceId from start/status and explicit user authorization. Abort ends observation, not the app. See docs/live-previews.md.`,
      parameters: Type.Object({
        action: Type.Union([Type.Literal("start"), Type.Literal("status"), Type.Literal("stop")]),
        command: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
        env: Type.Optional(Type.Record(Type.String(), Type.String())),
        readyPath: Type.Optional(Type.String()),
        timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
        instanceId: Type.Optional(Type.String()),
        replace: Type.Optional(Type.String()),
      }),
      async execute(_id, params, signal) {
        const text = await previewRequest(params, signal);
        return { content: [{ type: "text", text }], details: JSON.parse(text) };
      },
    }),
  );
}
