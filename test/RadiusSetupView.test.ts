import assert from "node:assert/strict";
import { test } from "node:test";
import type { RadiusSetupState } from "../shared/radius.ts";
import {
  type RadiusSetupInput,
  radiusDoneMessage,
  radiusSetupView,
  radiusUninstallCopy,
} from "../web/src/lib/radiusSetupView.ts";

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
  assert.equal(signedOut.mcp.install?.enabled, false);
  assert.equal(signedOut.webSearch.install?.enabled, false);

  const signedIn = view();
  assert.equal(signedIn.account.description, undefined);
  assert.equal(signedIn.account.canSignOut, true);
  assert.equal(signedIn.mcp.install?.enabled, true);
  assert.equal(signedIn.webSearch.install?.enabled, true);
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
  assert.equal(blocked.mcp.install?.enabled, false);
  assert.equal(blocked.mcp.detail, "Disabled in mcp.json.");
  assert.equal(blocked.mcp.uninstall?.enabled, true);
  assert.equal(blocked.webSearch.install?.enabled, false);
  assert.equal(blocked.webSearch.uninstall, undefined);
});

test("removal stays available while signed out", () => {
  const signedOut = view({ state: ready, providers: radius(false) });
  assert.deepEqual(signedOut.mcp.uninstall?.confirmation, { kind: "remove-mcp", key: "mcp-key" });
  assert.equal(signedOut.mcp.uninstall?.enabled, true);
  assert.equal(signedOut.webSearch.uninstall?.enabled, true);
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
    assert.equal(running.mcp.uninstall?.enabled, false);
    assert.equal(running.webSearch.uninstall?.enabled, false);
    const fresh = view({ state: { ...missing, installation: { status: "running", action } } });
    assert.equal(fresh.mcp.install?.enabled, false);
    // Refresh reads Pi again, so it stays available while Pi runs the change.
    assert.equal(running.canRefresh, true);
  }
});

test("a change in flight locks every step and refresh; sign-out is not a setup change", () => {
  const installing = view({ running: "configure-mcp" });
  assert.equal(installing.changing, true);
  assert.equal(installing.locked, true);
  assert.equal(installing.canRefresh, false);
  assert.equal(installing.mcp.install?.enabled, false);
  assert.equal(installing.webSearch.install?.enabled, false);

  const signingOut = view({ running: "sign-out" });
  assert.equal(signingOut.changing, false);
  assert.equal(signingOut.account.signingOut, true);
  assert.equal(signingOut.locked, true);
  assert.equal(signingOut.canRefresh, false);
});

test("the folded summary reports each tool's state", () => {
  assert.equal(view().tools.summary, "MCP not installed · Web search not installed");
  assert.equal(
    view({ state: { ...missing, mcp: { status: "ready" } } }).tools.summary,
    "MCP installed · Web search not installed",
  );
  const both = view({ state: ready });
  assert.equal(both.tools.summary, "MCP installed · Web search installed");
  assert.equal(both.tools.ready, true);
  assert.equal(both.mcp.install, undefined);
  assert.equal(both.webSearch.install, undefined);
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

test("each tool offers Install until installed and Uninstall while Pi reports its configuration", () => {
  const fresh = view();
  assert.deepEqual(fresh.mcp.install, {
    label: "Install",
    ariaLabel: "Install Radius MCP",
    enabled: true,
    action: "configure-mcp",
  });
  assert.deepEqual(fresh.webSearch.install, {
    label: "Install",
    ariaLabel: "Install web search",
    enabled: true,
    action: "install-web-search",
  });
  assert.equal(fresh.mcp.uninstall, undefined);
  assert.equal(fresh.webSearch.uninstall, undefined);

  const installed = view({ state: ready });
  assert.deepEqual(installed.mcp.uninstall, {
    label: "Uninstall",
    ariaLabel: "Uninstall Radius MCP",
    enabled: true,
    confirmation: { kind: "remove-mcp", key: "mcp-key" },
  });
  assert.deepEqual(installed.webSearch.uninstall, {
    label: "Uninstall",
    ariaLabel: "Uninstall web search",
    enabled: true,
    confirmation: { kind: "uninstall-web-search", key: "package-key" },
  });
  assert.equal(installed.mcp.readyLabel, "Installed");
  assert.equal(installed.webSearch.readyLabel, "Installed");
  // Only web search carries the organization note.
  assert.equal(installed.mcp.note, undefined);
  assert.equal(
    installed.webSearch.note,
    "An organization owner or admin must enable Web search separately in Radius.",
  );
});

test("each uninstall is confirmed in its own tool's words, and MCP changes announce themselves", () => {
  assert.deepEqual(radiusUninstallCopy("remove-mcp"), {
    title: "Uninstall Radius MCP?",
    description: "Uninstalls Radius MCP from Pi on this machine.",
    action: "Uninstall",
  });
  assert.deepEqual(radiusUninstallCopy("uninstall-web-search"), {
    title: "Uninstall web search?",
    description: "Removes the Radius web-search extension from Pi on this machine.",
    action: "Uninstall",
  });
  assert.equal(
    radiusDoneMessage("configure-mcp"),
    "Radius MCP installed. Start a new session to use it.",
  );
  assert.equal(radiusDoneMessage("remove-mcp"), "Radius MCP uninstalled for new sessions.");
  // Web search reports its own outcome once Pi's background change settles.
  assert.equal(radiusDoneMessage("install-web-search"), undefined);
  assert.equal(radiusDoneMessage("uninstall-web-search"), undefined);
});
