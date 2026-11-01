import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ownerRequest } from "../../scripts/PreviewClient.ts";
import { START_TIMEOUT_SECONDS } from "../../scripts/PreviewReadiness.ts";

/** Bundled Pi extension: one managed app preview per workspace, run for this session. */
export default function pianoPreview(pi: ExtensionAPI) {
  registerPreview(pi);
}

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
      promptSnippet:
        "Run the inspected current-checkout app, or inspect/stop its managed preview; not generic file hosting",
      promptGuidelines: [
        "When asked to run an app, first inspect the actual current checkout's instructions and dev/start entry point, then use piano_preview for that app. Monorepo apps within this checkout and Python apps are supported. It fixes cwd to this session's workspace; do not select a sibling checkout, unrelated directory or temporary document root. command[0] may be a bare name such as node, npx or python3. Use strict 127.0.0.1 binding with {port} in argv or injected PORT; no silent port fallback. Pass only required app environment, never Piano credentials.",
        "piano_preview is not generic file hosting. Do not manufacture a static server or inline HTTP listener to serve generated HTML, reports or documents, even inside this checkout. Wrapping file hosting in a package script does not make it an application entry point. Use file preview or artifact delivery instead. Do not work around a rejected/unsupported launch with bash, a shell wrapper or an unmanaged server. Admission catches known direct static servers and explicit unrelated launch roots; arbitrary scripts remain trusted developer code, not sandboxed or certified by admission.",
        "If this Pi generation owns the workspace's app, start without command returns it. Another session's app is an ownership conflict, never reused or transferred. To run a different command or restart, pass replace with the exact current instanceId, only when the user asked for a restart or a change, or the current instance failed, exited, or is no longer warming up and still not ready. A warming instance (warming: true) is running and has not answered yet, as a cold app compiling assets or running migrations does: it is not a failed start. Do not replace or restart it; report its recent logs, and read status later. Piano keeps checking its readiness and shows the preview once it answers.",
        `Report observed local readiness and a Markdown preview link. ${host.access} Keep the app running after your reply. On interruption or uncertain completion read status before starting again. If the supervisor/configuration is unavailable, report the limitation; do not fall back to an unowned process.`,
      ],
      description: `Run the inspected current checkout's actual app dev/start entry point, including monorepo and Python apps; not a generic file host. No sibling/unrelated/temporary document roots, manufactured static servers or inline listeners for generated HTML/reports, or bash workarounds: use file preview or artifact delivery. A package script wrapping file hosting is not an application entry point. Identifiable unsupported launches are rejected before submission and before replacement stops the old instance; admission does not certify arbitrary scripts or provide a sandbox. One managed app per canonical workspace, owned by this session's live Pi generation and executed by ${host.supervisor}. It survives turn completion, abort and browser disconnect, but stops when Pi ends (including archive/delete or Piano shutdown). Reopening never adopts or relaunches it. start chooses a supported free port and waits up to timeoutSeconds (default ${START_TIMEOUT_SECONDS.default}, at most ${START_TIMEOUT_SECONDS.max}) for an owned loopback HTTP listener that answers the preview hostname with 2xx/3xx; each check is one GET of readyPath with its own short timeout. A start that ends its wait while the app runs unanswered returns warming: true and leaves it running. When this generation owns an app, start returns it (specChanged if the request differs) and launches nothing; another session's app is an ownership conflict, even if failed; replace with its exact instanceId stops it and launches this request, or the same launch when command is omitted; a replace naming an instance that is no longer current returns not-current and launches nothing. command is argv (no shell interpretation), with {port} substitution; PORT is injected and refused in env; a bare command[0] resolves on the app's PATH. status reconciles saved intent and returns state (starting, running, exited, failed, stopping or not-loaded), bounded startup logs, identities, cwd, selected port, local readiness and the preview URL. stop requires the exact instanceId from start/status and explicit user authorization. Abort ends observation, not the app.`,
      parameters: Type.Object({
        action: Type.Union([Type.Literal("start"), Type.Literal("status"), Type.Literal("stop")]),
        command: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
        env: Type.Optional(Type.Record(Type.String(), Type.String())),
        readyPath: Type.Optional(Type.String()),
        timeoutSeconds: Type.Optional(
          Type.Number({ minimum: START_TIMEOUT_SECONDS.min, maximum: START_TIMEOUT_SECONDS.max }),
        ),
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
