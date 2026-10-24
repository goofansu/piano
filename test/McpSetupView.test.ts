import assert from "node:assert/strict";
import { test } from "node:test";
import type { McpServerSetup } from "../shared/mcp.ts";
import {
  type McpSetupInput,
  mcpRemovalCopy,
  mcpSetupView,
  signInAfterInstall,
} from "../web/src/lib/mcpSetupView.ts";

const linear = (setup: Partial<McpServerSetup> = {}): McpServerSetup => ({
  id: "linear",
  status: "missing",
  oauth: true,
  signedIn: false,
  ...setup,
});
const view = (input: Partial<McpSetupInput> = {}) =>
  mcpSetupView({
    state: { servers: [linear()] },
    running: undefined,
    loading: false,
    loadFailed: false,
    ...input,
  });
const row = (setup: Partial<McpServerSetup>) =>
  view({ state: { servers: [linear(setup)] } }).rows?.[0];

test("each server offers only the actions its setup allows", () => {
  assert.deepEqual(row({ status: "missing" })?.actions, ["install"]);
  assert.deepEqual(row({ status: "ready", removalKey: "k" })?.actions, ["sign-in", "uninstall"]);
  assert.deepEqual(row({ status: "ready", signedIn: true, removalKey: "k" })?.actions, [
    "sign-out",
    "uninstall",
  ]);
  // A configured Authorization header needs no sign-in.
  assert.deepEqual(row({ status: "ready", oauth: false, removalKey: "k" })?.actions, ["uninstall"]);
  // Blocked by configuration: nothing to install, removable only when Pi gives its identity.
  assert.deepEqual(row({ status: "blocked", detail: "Disabled." })?.actions, []);
  const blocked = row({ status: "blocked", detail: "Disabled.", removalKey: "k" });
  assert.deepEqual(blocked?.actions, ["uninstall"]);
  assert.equal(blocked?.removalKey, "k");
  assert.equal(blocked?.detail, "Disabled.");
});

test("a server is marked ready once configured, and signed in when it uses OAuth", () => {
  assert.equal(row({ status: "missing" })?.ready, false);
  assert.equal(row({ status: "ready" })?.ready, false);
  assert.equal(row({ status: "ready", signedIn: true })?.ready, true);
  assert.equal(row({ status: "ready", oauth: false })?.ready, true);
  assert.equal(row({ status: "blocked", signedIn: true })?.ready, false);
});

test("rows wait for the first read and list only servers Pi reports", () => {
  assert.equal(view({ state: undefined }).rows, undefined);
  assert.deepEqual(view({ state: { servers: [] } }).rows, []);
  assert.equal(view().rows?.[0]?.server.name, "Linear");
});

test("a change, read or read failure disables the rows", () => {
  assert.equal(view().disabled, false);
  assert.equal(view({ running: "install" }).disabled, true);
  assert.equal(view({ loading: true }).disabled, true);
  assert.equal(view({ loadFailed: true }).disabled, true);
});

test("installing goes on to sign in only when the server is ready and awaits OAuth sign-in", () => {
  const after = (setup: Partial<McpServerSetup>) =>
    signInAfterInstall({ servers: [linear(setup)] }, "linear");
  assert.equal(after({ status: "ready" }), true);
  assert.equal(after({ status: "ready", signedIn: true }), false);
  assert.equal(after({ status: "ready", oauth: false }), false);
  assert.equal(after({ status: "blocked" }), false);
  assert.equal(signInAfterInstall(undefined, "linear"), false);
});

test("the uninstall confirmation names the server", () => {
  assert.deepEqual(mcpRemovalCopy("Linear"), {
    title: "Uninstall Linear MCP?",
    description: "Removes Linear MCP and its saved sign-in from Pi on this machine.",
    action: "Uninstall",
    done: "Linear MCP uninstalled for new sessions.",
  });
});
