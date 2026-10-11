import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { subagentUsage } from "../server/RunLedger.ts";
import type { RenderMsg, SessionStats, SubagentUsage } from "../shared/wire.ts";

// Load the real TSX component through the application's existing Vite transform.
const vite = await createServer({ root: path.resolve("web"), server: { middlewareMode: true, watch: null }, appType: "custom" });
after(() => vite.close());
const { ContextDetails } = await vite.ssrLoadModule("/src/components/ContextDetails.tsx") as {
  ContextDetails: ComponentType<{ cost?: number; totals?: SessionStats["tokens"]; messages: ReadonlyArray<RenderMsg>; subagents?: SubagentUsage }>;
};
const totals = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 };
// The server folds deliveries into `subagents`; the popover renders what it is given.
const render = (deliveries: RenderMsg[]) => renderToStaticMarkup(createElement(ContextDetails, { cost: 0.5, totals, messages: [], subagents: subagentUsage(deliveries) }));
const result = (runId: string, profile: string, usage: Record<string, number> | undefined, model?: string): RenderMsg =>
  ({ id: runId + profile, role: "context", label: "subagent-notification", text: "", subagent: { kind: "result", source: "notification", runId, profile, status: "Completed", ...(usage ? { usage: usage as never } : {}), ...(model ? { model } : {}) } });
const rows = (html: string) => {
  const table = /aria-label="Subagent usage by profile".*?<\/table>/s.exec(html)?.[0] ?? "";
  return [...table.matchAll(/<tr.*?<\/tr>/gs)].map(([row]) => row.replace(/<[^>]+>/g, "|").split("|").filter(Boolean));
};

test("Subagents rows sit below main-only Session usage, one per Profile that spent anything", () => {
  const html = render([
    result("run-qbdd-1", "usage-probe-pi", { input: 3518, output: 6, cacheRead: 0, cacheWrite: 0, cost: 0.007096 }, "openai/gpt-6.1-sol"),
    result("run-qbdd-2", "usage-probe-claude", { input: 10, output: 106, cacheRead: 0, cacheWrite: 20786, cost: 0.042112 }, "claude-haiku-4-5-20251001"),
    result("run-idle", "usage-probe-idle", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }),
    result("run-mixed-1", "mixed", { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, "one"),
    result("run-mixed-2", "mixed", { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, "two"),
  ]);
  assert.ok(html.indexOf('aria-label="Token and cost breakdown"') < html.indexOf('aria-label="Subagent usage by profile"'));
  assert.deepEqual(rows(html), [
    ["Subagents", "Tokens", "Cost"],
    ["usage-probe-pi", "openai/gpt-6.1-sol", "3,524", "$0.0071"],
    ["usage-probe-claude", "claude-haiku-4-5-20251001", "20,902", "$0.0421"],
    ["mixed", "2", "$0.0000"],
    ["All subagents", "24,428", "$0.0492"],
    ["Session + subagents", "24,548", "$0.5492"],
  ]);
  assert.match(html, /<th[^>]*>Total tokens<\/th><td[^>]*>—<\/td><td[^>]*>120<\/td>/, "the Session column stays Pi's main-session figure");
  assert.match(html, /<th[^>]*>Cost<\/th><td[^>]*>—<\/td><td[^>]*>\$0\.5000<\/td>/);
});

test("the Subagents group is hidden without usage or when every Run spent nothing", () => {
  assert.doesNotMatch(render([result("r1", "a", undefined)]), /Subagent usage by profile/);
  assert.doesNotMatch(render([result("r1", "a", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })]), /Subagent usage by profile/);
});
