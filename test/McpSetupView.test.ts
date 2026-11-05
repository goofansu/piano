import assert from "node:assert/strict";
import { test } from "node:test";
import type { McpServerSetup, McpSetupState } from "../shared/mcp.ts";
import {
  type McpSetupInput,
  mcpRemovalCopy,
  mcpSetupView,
  signInAfterAdd,
  signInAfterInstall,
} from "../web/src/lib/mcpSetupView.ts";

const http = (setup: Partial<McpServerSetup> = {}): McpServerSetup => ({
  name: "linear",
  catalog: "linear",
  config: { url: "https://mcp.linear.app/mcp", headers: {}, hasAuthorization: false },
  oauth: true,
  signedIn: false,
  removalKey: "k",
  ...setup,
});
const docs = (setup: Partial<McpServerSetup> = {}): McpServerSetup =>
  http({
    name: "docs",
    catalog: undefined,
    config: { url: "https://mcp.example.com/mcp", headers: {}, hasAuthorization: true },
    oauth: false,
    ...setup,
  });
const tools: McpServerSetup = {
  name: "tools",
  config: { command: "uvx", args: ["tools-mcp"], env: { API_KEY: "${TOOLS_KEY}" } },
  oauth: false,
  signedIn: false,
  removalKey: "k",
};
const state = (servers: McpServerSetup[], extra: Partial<McpSetupState> = {}): McpSetupState => ({
  servers,
  available: [],
  ...extra,
});
const view = (input: Partial<McpSetupInput> = {}) =>
  mcpSetupView({
    state: state([http()]),
    running: undefined,
    loading: false,
    loadFailed: false,
    ...input,
  });
const row = (setup: McpServerSetup) => view({ state: state([setup]) }).rows?.[0];

test("each entry offers the actions its setup allows, in order", () => {
  assert.deepEqual(row(http())?.actions, ["sign-in", "edit", "remove"]);
  assert.deepEqual(row(http({ signedIn: true }))?.actions, ["sign-out", "edit", "remove"]);
  // A configured Authorization header, or a local command, needs no sign-in.
  assert.deepEqual(row(docs())?.actions, ["edit", "remove"]);
  assert.deepEqual(row(tools)?.actions, ["edit", "remove"]);
  // Disabled in Pi: nothing to sign in to, still removable and editable; the problem is shown.
  const blocked = row(http({ detail: "Disabled." }));
  assert.deepEqual(blocked?.actions, ["edit", "remove"]);
  assert.equal(blocked?.detail, "Disabled.");
});

test("an entry is ready once configured, and signed in when it uses OAuth", () => {
  assert.equal(row(http())?.ready, false);
  assert.equal(row(http({ signedIn: true }))?.ready, true);
  assert.equal(row(docs())?.ready, true);
  assert.equal(row(tools)?.ready, true);
  assert.equal(row(http({ signedIn: true, detail: "Disabled." }))?.ready, false);
});

test("a row is titled by its catalog server, else by its entry name, with its host or command beneath", () => {
  const linear = row(http({ name: "mine" }));
  assert.equal(linear?.title, "Linear");
  assert.equal(linear?.catalog, "linear");
  assert.equal(linear?.value, "mcp.linear.app");
  assert.equal(linear?.removeVerb, "Uninstall");
  const custom = row(docs());
  assert.equal(custom?.title, "docs");
  assert.equal(custom?.catalog, undefined);
  assert.equal(custom?.value, "mcp.example.com");
  assert.equal(custom?.removeVerb, "Remove");
  assert.equal(row(tools)?.value, "uvx tools-mcp");
  assert.equal(
    row(docs({ config: { url: "not a url", headers: {}, hasAuthorization: false } }))?.value,
    "not a url",
  );
});

test("rows and available servers wait for the first read; the catalog fills the available rows", () => {
  const empty = view({ state: undefined });
  assert.equal(empty.rows, undefined);
  assert.equal(empty.available, undefined);
  const read = view({
    state: state([], { available: [{ id: "jira" }, { id: "paper", detail: "Named already." }] }),
  });
  assert.deepEqual(read.rows, []);
  assert.deepEqual(
    read.available?.map((row) => [row.server.name, row.detail]),
    [
      ["Jira", undefined],
      ["Paper", "Named already."],
    ],
  );
});

test("a change, read, read failure or Pi problem disables the rows; the problem is shown", () => {
  assert.equal(view().disabled, false);
  assert.equal(view({ running: "install" }).disabled, true);
  assert.equal(view({ loading: true }).disabled, true);
  assert.equal(view({ loadFailed: true }).disabled, true);
  const problem = view({ state: state([], { problem: "MCP is off." }) });
  assert.equal(problem.disabled, true);
  assert.equal(problem.problem, "MCP is off.");
});

test("installing or adding goes on to sign in only to an entry ready and awaiting OAuth sign-in", () => {
  assert.equal(signInAfterInstall(state([http()]), "linear")?.name, "linear");
  assert.equal(signInAfterInstall(state([http({ name: "mine" })]), "linear")?.name, "mine");
  assert.equal(signInAfterInstall(state([http({ signedIn: true })]), "linear"), undefined);
  assert.equal(signInAfterInstall(state([http({ detail: "Disabled." })]), "linear"), undefined);
  assert.equal(signInAfterInstall(state([docs()]), "linear"), undefined);
  assert.equal(signInAfterInstall(undefined, "linear"), undefined);

  const added = state([docs(), tools, http({ name: "sentry", catalog: undefined })]);
  assert.equal(signInAfterAdd(added, ["docs", "tools", "sentry"])?.name, "sentry");
  assert.equal(signInAfterAdd(added, ["docs", "tools"]), undefined);
  assert.equal(signInAfterAdd(undefined, ["sentry"]), undefined);
});

test("the removal confirmation names the server and its verb", () => {
  assert.deepEqual(mcpRemovalCopy({ title: "Linear", removeVerb: "Uninstall" }), {
    title: "Uninstall Linear MCP?",
    description: "Removes Linear MCP and its saved sign-in from Pi on this machine.",
    action: "Uninstall",
    done: "Linear MCP uninstalled for new sessions.",
  });
  assert.deepEqual(mcpRemovalCopy({ title: "docs", removeVerb: "Remove" }), {
    title: "Remove docs MCP?",
    description: "Removes docs MCP and its saved sign-in from Pi on this machine.",
    action: "Remove",
    done: "docs MCP removed for new sessions.",
  });
});
