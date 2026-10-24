import assert from "node:assert/strict";
import { test } from "node:test";
import { sameSession, sessionKey } from "../shared/wire.ts";

test("a session key does not collide across cwd and id splits", () => {
  assert.notEqual(sessionKey("a,b", "c"), sessionKey("a", "b,c"));
  assert.equal(sessionKey("/x", "1"), sessionKey("/x", "1"));
});

test("sameSession needs both the cwd and the id to match", () => {
  const a = { cwd: "/x", sessionId: "1" };
  assert.ok(sameSession(a, { cwd: "/x", sessionId: "1" }));
  assert.ok(!sameSession(a, { cwd: "/x", sessionId: "2" }));
  assert.ok(!sameSession(a, { cwd: "/y", sessionId: "1" }));
});
