import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRoute, routePath } from "../web/src/lib/routes.ts";

test("settings URLs preserve each section and accept the Providers alias", () => {
  for (const section of ["providers", "radius", "mcp"] as const) {
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
