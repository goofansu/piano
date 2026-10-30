/**
 * What Open preview puts on screen and into the draft. The frame is another origin: it can run
 * as itself, and it cannot navigate Piano. Asking names the registered entry page, not a route
 * Piano cannot see.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionPreview } from "../shared/wire.ts";
import { type CommandEffects, runCommand } from "../web/src/lib/commands.ts";
import { sessionCommands } from "../web/src/lib/sessionCommands.ts";
import { PREVIEW_FRAME_SANDBOX, previewDraft } from "../web/src/lib/sessionPreview.ts";
import { type AppState, initialState, type SessionView } from "../web/src/store.ts";

const app = (preview: Partial<SessionPreview> = {}): SessionPreview => ({
  instanceId: "i1",
  state: "running",
  ready: true,
  url: "http://127.0.0.1:9400/",
  port: 9400,
  command: ["node", "app.mjs"],
  detail: "",
  externalAccess: "same-host",
  observedAt: 0,
  ...preview,
});

const running = (): AppState => ({
  ...initialState,
  connected: true,
  selectionId: "sel",
  view: { kind: "session" },
  session: {
    cwd: "/work/repo.feature",
    sessionId: "s1",
    hosted: true,
    cursor: null,
    state: { sessionId: "s1", isStreaming: false, preview: app() },
    messages: [],
    dialogs: [],
  } as SessionView,
});

test("the preview frame can run the app and cannot navigate Piano", () => {
  assert.match(PREVIEW_FRAME_SANDBOX, /\ballow-scripts\b/);
  assert.match(PREVIEW_FRAME_SANDBOX, /\ballow-same-origin\b/);
  assert.doesNotMatch(PREVIEW_FRAME_SANDBOX, /allow-top-navigation/);
});

test("asking about a preview names its entry page and workspace, not a page Piano cannot see", () => {
  const text = previewDraft("http://127.0.0.1:9400/", "/work/repo.feature");
  assert.match(text, /http:\/\/127\.0\.0\.1:9400\//);
  assert.match(text, /\/work\/repo\.feature/);
  assert.match(text, /entry page/);
  assert.match(text, /not observed/);
});

test("opening the preview beside the conversation does not open a tab or talk to the app", () => {
  const command = sessionCommands(running()).find((c) => c.id === "open-preview");
  assert.equal(command?.intent.kind, "open-preview");
  const called: string[] = [];
  const effects = new Proxy(
    {
      openPreview: () => called.push("panel"),
      openUrl: () => called.push("tab"),
      send: () => called.push("send"),
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop as keyof typeof target];
        return () => {
          throw new Error(`unexpected ${String(prop)}`);
        };
      },
    },
  ) as unknown as CommandEffects;
  assert.equal(command && runCommand(command, effects), true);
  assert.deepEqual(called, ["panel"]);
});
