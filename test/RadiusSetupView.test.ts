import assert from "node:assert/strict";
import { test } from "node:test";
import type { RadiusSetupState } from "../shared/radius.ts";
import { type RadiusSetupInput, radiusSetupView } from "../web/src/lib/radiusSetupView.ts";

const missing: RadiusSetupState = {
  mcp: { status: "missing" },
  webSearch: { status: "missing" },
  installation: { status: "idle" },
};
const ready: RadiusSetupState = {
  mcp: { status: "ready", removalKey: "mcp-key" },
  webSearch: { status: "ready", removalKey: "package-key" },
  installation: { status: "idle" },
};
const radius = (signedIn: boolean) => [
  { id: "anthropic", name: "Anthropic", signedIn: true },
  { id: "radius", name: "Radius", signedIn },
];
const view = (input: Partial<RadiusSetupInput> = {}) =>
  radiusSetupView({
    state: missing,
    providers: radius(true),
    running: undefined,
    refreshing: false,
    loadFailed: false,
    actionError: "",
    ...input,
  });

test("signed out, the account is offered and neither tool can be set up", () => {
  const signedOut = view({ providers: radius(false) });
  assert.equal(signedOut.account.canSignIn, true);
  assert.equal(signedOut.account.canSignOut, false);
  assert.equal(signedOut.account.description, "Sign in to set up Radius tools and web search.");
  assert.equal(signedOut.mcp.canAdd, false);
  assert.equal(signedOut.webSearch.canInstall, false);

  const signedIn = view();
  assert.equal(signedIn.account.description, undefined);
  assert.equal(signedIn.account.canSignOut, true);
  assert.equal(signedIn.mcp.canAdd, true);
  assert.equal(signedIn.webSearch.canInstall, true);
});

test("without Radius in this Pi, sign-in is unavailable and says so", () => {
  const unavailable = view({ providers: [{ id: "anthropic", name: "Anthropic", signedIn: true }] });
  assert.equal(unavailable.account.available, false);
  assert.equal(unavailable.account.canSignIn, false);
  assert.equal(
    unavailable.account.description,
    "Radius sign-in is unavailable in this Pi installation.",
  );
});

test("a step Pi reports as blocked stays unavailable after sign-in, and can still be removed", () => {
  const blocked = view({
    state: {
      ...missing,
      mcp: { status: "blocked", detail: "Disabled in mcp.json.", removalKey: "mcp-key" },
      webSearch: { status: "blocked", detail: "Custom package filter." },
    },
  });
  assert.equal(blocked.mcp.canAdd, false);
  assert.equal(blocked.mcp.detail, "Disabled in mcp.json.");
  assert.equal(blocked.mcp.canRemove, true);
  assert.equal(blocked.webSearch.canInstall, false);
  assert.equal(blocked.webSearch.canRemove, false);
});

test("removal stays available while signed out", () => {
  const signedOut = view({ state: ready, providers: radius(false) });
  assert.equal(signedOut.mcp.removalKey, "mcp-key");
  assert.equal(signedOut.mcp.canRemove, true);
  assert.equal(signedOut.webSearch.canRemove, true);
});

test("a running web-search change locks every step and words the summary by action", () => {
  for (const [action, summary, label] of [
    ["install", "Installing web search…", "Installing…"],
    ["uninstall", "Uninstalling web search…", "Uninstalling…"],
  ] as const) {
    const running = view({
      state: { ...ready, installation: { status: "running", action } },
    });
    assert.equal(running.locked, true);
    assert.equal(running.tools.summary, summary);
    assert.deepEqual(running.webSearch.change, { action, label });
    assert.equal(running.account.canSignOut, false);
    assert.equal(running.mcp.canRemove, false);
    assert.equal(running.webSearch.canRemove, false);
    const fresh = view({ state: { ...missing, installation: { status: "running", action } } });
    assert.equal(fresh.mcp.canAdd, false);
    // Refresh reads Pi again, so it stays available while Pi runs the change.
    assert.equal(running.canRefresh, true);
  }
});

test("a change in flight locks every step and refresh; sign-out is not a setup change", () => {
  const adding = view({ running: "configure-mcp" });
  assert.equal(adding.changing, true);
  assert.equal(adding.locked, true);
  assert.equal(adding.canRefresh, false);
  assert.equal(adding.mcp.canAdd, false);
  assert.equal(adding.webSearch.canInstall, false);

  const signingOut = view({ running: "sign-out" });
  assert.equal(signingOut.changing, false);
  assert.equal(signingOut.account.signingOut, true);
  assert.equal(signingOut.locked, true);
  assert.equal(signingOut.canRefresh, false);
});

test("the folded summary reports each tool's state", () => {
  assert.equal(view().tools.summary, "MCP not added · Web search not installed");
  assert.equal(
    view({ state: { ...missing, mcp: { status: "ready" } } }).tools.summary,
    "MCP added · Web search not installed",
  );
  const both = view({ state: ready });
  assert.equal(both.tools.summary, "MCP added · Web search installed");
  assert.equal(both.tools.ready, true);
  assert.equal(both.mcp.canAdd, false);
  assert.equal(both.webSearch.canInstall, false);
});

test("a failed web-search change is titled by its action", () => {
  const failed = (action: "install" | "uninstall") =>
    view({ state: { ...ready, installation: { status: "error", action, detail: "npm failed" } } })
      .installationError;
  assert.deepEqual(failed("install"), {
    title: "Web search was not installed",
    detail: "npm failed",
  });
  assert.equal(failed("uninstall")?.title, "Web search was not uninstalled");
  assert.equal(view({ state: ready }).installationError, undefined);
});

test("configured requires sign-in, both tools ready and no failed web-search change", () => {
  assert.equal(view({ state: ready }).configured, true);
  assert.equal(view({ state: ready, providers: radius(false) }).configured, false);
  assert.equal(view({ state: { ...ready, mcp: { status: "missing" } } }).configured, false);
  assert.equal(view({ state: { ...ready, webSearch: { status: "missing" } } }).configured, false);
  assert.equal(
    view({ state: { ...ready, installation: { status: "error", action: "install" } } }).configured,
    false,
  );
  assert.equal(view({ state: undefined }).configured, false);
});

test("settled only once read, with nothing running and nothing failing", () => {
  assert.equal(view({ state: ready }).settled, true);
  assert.equal(view({ state: undefined }).settled, false);
  assert.equal(view({ running: "install-web-search" }).settled, false);
  assert.equal(view({ running: "sign-out" }).settled, false);
  assert.equal(view({ refreshing: true }).settled, false);
  assert.equal(
    view({ state: { ...ready, installation: { status: "running", action: "install" } } }).settled,
    false,
  );
  assert.equal(view({ actionError: "Could not complete setup." }).settled, false);
  assert.equal(view({ loadFailed: true }).settled, false);
});

test("a failed read or change needs attention, and a failed read locks the steps", () => {
  const unreadable = view({ loadFailed: true });
  assert.equal(
    unreadable.attention,
    "Could not refresh Radius setup. Check your connection and try again.",
  );
  assert.equal(unreadable.locked, true);
  assert.equal(unreadable.canRefresh, true);

  const failedChange = view({ actionError: "Could not complete setup. Refresh before retrying." });
  assert.equal(failedChange.attention, "Could not complete setup. Refresh before retrying.");
  assert.equal(failedChange.locked, false);
  assert.equal(view().attention, undefined);
});
