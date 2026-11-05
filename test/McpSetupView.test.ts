import assert from "node:assert/strict";
import { test } from "node:test";
import type { McpServerSetup, McpSetupState } from "../shared/mcp.ts";
import { type McpSetupInput, mcpManageCopy, mcpSetupView } from "../web/src/lib/mcpSetupView.ts";

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

test("Manage edits only a server the user added, disconnects a URL server and deletes a local command", () => {
  const manage = (setup: McpServerSetup) => {
    const shown = row(setup)!;
    return [shown.editable, shown.removeVerb];
  };
  assert.deepEqual(manage(http()), [false, "Disconnect"]);
  assert.deepEqual(manage(docs()), [true, "Disconnect"]);
  assert.deepEqual(manage(tools), [true, "Delete"]);
});

test("Reconnect appears only for an OAuth server whose sign-in is gone and that Pi can use", () => {
  assert.equal(row(http())?.reconnect, true);
  assert.equal(row(http({ signedIn: true }))?.reconnect, false);
  // A configured Authorization header, or a local command, never signs in.
  assert.equal(row(docs())?.reconnect, false);
  assert.equal(row(tools)?.reconnect, false);
  // Disabled in Pi: the problem is shown instead.
  const blocked = row(http({ detail: "Disabled." }));
  assert.deepEqual([blocked?.reconnect, blocked?.detail], [false, "Disabled."]);
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
  const custom = row(docs());
  assert.equal(custom?.title, "docs");
  assert.equal(custom?.catalog, undefined);
  assert.equal(custom?.value, "mcp.example.com");
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
    state: state([], { available: [{ id: "linear", detail: "Named already." }, { id: "jira" }] }),
  });
  assert.deepEqual(read.rows, []);
  assert.deepEqual(
    read.available?.map((row) => [row.server.name, row.detail]),
    [
      ["Linear", "Named already."],
      ["Jira", undefined],
    ],
  );
});

test("a change, read, read failure or Pi problem disables the rows; the problem is shown", () => {
  assert.equal(view().disabled, false);
  assert.equal(view({ running: "connect:linear" }).disabled, true);
  assert.equal(view({ loading: true }).disabled, true);
  assert.equal(view({ loadFailed: true }).disabled, true);
  const problem = view({ state: state([], { problem: "MCP is off." }) });
  assert.equal(problem.disabled, true);
  assert.equal(problem.problem, "MCP is off.");
});

test("Manage says what its removal takes away, and the toast names what was done", () => {
  assert.deepEqual(mcpManageCopy({ title: "Linear", removeVerb: "Disconnect" }), {
    description: "Disconnect removes Linear MCP and its saved sign-in from Pi on this machine.",
    done: "Linear MCP disconnected.",
  });
  assert.deepEqual(mcpManageCopy({ title: "tools", removeVerb: "Delete" }), {
    description: "Delete removes tools MCP from Pi on this machine.",
    done: "tools MCP deleted.",
  });
});
