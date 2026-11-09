import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionLink } from "../shared/sessionLink.ts";
import { parseRoute, routePath } from "../web/src/lib/routes.ts";

test("settings URLs preserve each section and accept the Providers alias", () => {
  for (const section of [
    "providers",
    "mcp",
    "skills",
    "prompts",
    "webhooks",
    "preferences",
  ] as const) {
    const route = { kind: "settings", section } as const;
    assert.equal(routePath(route), `/settings/${section}`);
    assert.deepEqual(parseRoute({ pathname: `/settings/${section}` }), route);
    assert.deepEqual(parseRoute({ pathname: `/settings/${section}/` }), route);
  }
  assert.deepEqual(parseRoute({ pathname: "/settings" }), {
    kind: "settings",
    section: "providers",
  });
  assert.deepEqual(parseRoute({ pathname: "/settings/unknown" }), { kind: "new" });
});

test("the Projects index has an address of its own beside each project's home", () => {
  assert.equal(routePath({ kind: "projects" }), "/projects");
  assert.deepEqual(parseRoute({ pathname: "/projects" }), { kind: "projects" });
  assert.deepEqual(parseRoute({ pathname: "/projects/" }), { kind: "projects" });
  assert.deepEqual(parseRoute({ pathname: "/projects/p1" }), { kind: "project", projectId: "p1" });
  assert.deepEqual(parseRoute({ pathname: "/projects/p1/new" }), { kind: "new", projectId: "p1" });
});

test("the removed Radius URL is unknown rather than an alias for Providers", () => {
  assert.deepEqual(parseRoute({ pathname: "/settings/radius" }), { kind: "new" });
  assert.deepEqual(parseRoute({ pathname: "/settings/radius/" }), { kind: "new" });
});

test("a session link handed out of Piano opens the session the UI routes to", () => {
  const sessionId = "a/b c?#%";
  const link = new URL(sessionLink("https://piano.example", sessionId));
  assert.equal(link.origin, "https://piano.example");
  assert.equal(link.pathname, routePath({ kind: "session", sessionId }));
  assert.deepEqual(parseRoute(link), { kind: "session", sessionId });
});
