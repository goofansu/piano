import assert from "node:assert/strict";
import { test } from "node:test";
import type { OAuthProvider } from "../shared/wire.ts";
import {
  type ProvidersSettingsInput,
  providersSettingsView,
} from "../web/src/lib/providersSettingsView.ts";

const anthropic: OAuthProvider = { id: "anthropic", name: "Anthropic", signedIn: true };
const copilot: OAuthProvider = { id: "github-copilot", name: "GitHub Copilot", signedIn: false };
const radius: OAuthProvider = { id: "radius", name: "Radius", signedIn: true };

const view = (input: Partial<ProvidersSettingsInput> = {}) =>
  providersSettingsView({
    value: [radius, anthropic, copilot],
    failure: false,
    signingOut: undefined,
    ...input,
  });
const rows = (input: Partial<ProvidersSettingsInput> = {}) => {
  const { body } = view(input);
  assert.equal(body.kind, "list");
  return body.kind === "list" ? body.rows : [];
};

test("the list leaves Radius to its own section, and so does the sign-in dialog", () => {
  assert.deepEqual(
    rows().map((row) => row.provider.id),
    ["anthropic", "github-copilot"],
  );
  assert.deepEqual(
    view().providers.map((provider) => provider.id),
    ["anthropic", "github-copilot"],
  );
});

test("an empty catalog explains itself; a Radius-only catalog hides the list", () => {
  assert.deepEqual(view({ value: [] }).body, { kind: "empty" });
  assert.deepEqual(view({ value: [radius] }).body, { kind: "hidden" });
  assert.deepEqual(view({ value: [radius] }).providers, []);
});

test("the list waits for the first read, and a failed read takes precedence", () => {
  assert.deepEqual(view({ value: undefined }).body, { kind: "loading" });
  assert.deepEqual(view({ value: undefined }).providers, []);
  assert.deepEqual(view({ failure: true }).body, { kind: "error" });
  assert.deepEqual(view({ value: undefined, failure: true }).body, { kind: "error" });
  assert.deepEqual(view({ value: [radius], failure: true }).body, { kind: "error" });
});

test("a signed-out provider offers sign-in as the call to action; a signed-in one, sign-out", () => {
  const [signedIn, signedOut] = rows();
  assert.deepEqual(signedIn?.action, {
    label: "Sign out",
    ariaLabel: "Sign out of Anthropic",
    primary: false,
    enabled: true,
    intent: "confirm-sign-out",
  });
  assert.deepEqual(signedOut?.action, {
    label: "Sign in",
    ariaLabel: "Sign in to GitHub Copilot",
    primary: true,
    enabled: true,
    intent: "sign-in",
  });
});

test("a sign-out in flight disables every row and names only its own", () => {
  const during = rows({ signingOut: "anthropic" });
  assert.deepEqual(
    during.map((row) => [row.action.label, row.action.enabled]),
    [
      ["Signing out…", false],
      ["Sign in", false],
    ],
  );
});

test("known providers carry their logo; unknown ones have none", () => {
  const custom: OAuthProvider = { id: "acme", name: "Acme", signedIn: false };
  const inherited: OAuthProvider = { id: "toString", name: "toString", signedIn: false };
  const logos = rows({ value: [anthropic, copilot, custom, inherited] }).map((row) => row.logo);
  assert.deepEqual(logos, ["anthropic", "github-copilot", undefined, undefined]);
});
