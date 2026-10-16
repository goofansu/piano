import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseRoute,
  routePath,
  SETTINGS_PAGES,
  SETTINGS_SECTIONS,
  settingsPage,
} from "../web/src/lib/routes.ts";

test("settings URLs preserve each section and accept the Providers alias", () => {
  for (const section of ["providers", "radius", "mcp", "integrations"] as const) {
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
  // The page was renamed twice; neither old address is kept.
  for (const old of ["notifications", "exe-dev"])
    assert.deepEqual(parseRoute({ pathname: `/settings/${old}` }), { kind: "new" });
});

test("Radius addresses the Providers page, and is offered once in navigation", () => {
  assert.deepEqual(
    SETTINGS_PAGES.map((page) => page.id),
    ["providers", "mcp", "integrations"],
    "navigation lists one row per page, so Radius is not a row of its own",
  );
  assert.ok(
    SETTINGS_SECTIONS.some((section) => section.id === "radius"),
    "the palette still offers Radius by name",
  );
  assert.equal(settingsPage("radius"), "providers", "/settings/radius opens Providers");
  assert.equal(settingsPage("providers"), "providers");
  assert.equal(settingsPage("mcp"), "mcp");
});
