import assert from "node:assert/strict";
import { test } from "node:test";
import type { RenderMsg } from "../shared/wire.ts";
import { sessionArtifacts } from "../web/src/lib/sessionArtifacts.ts";

// Shapes as the radius-artifacts extension's calls and results reach the browser (PiRecords).
let next = 0;
function publish(
  tool: string,
  title: string,
  result: Record<string, unknown>,
  isError = result.status !== "confirmed",
): RenderMsg[] {
  const id = `call${++next}`;
  return [
    {
      id: `a${next}`,
      role: "assistant",
      text: "",
      toolCalls: [{ id, name: tool, args: JSON.stringify({ title, content: "# Body" }, null, 2) }],
    },
    {
      id: `t${next}`,
      role: "tool_result",
      toolName: tool,
      toolCallId: id,
      isError,
      text: JSON.stringify(result),
    },
  ];
}
const confirmed = (artifactId: string, url: string) => ({
  status: "confirmed",
  message: "Radius publication confirmed.",
  artifactId,
  url,
  revision: 1,
});

test("confirmed publications are listed newest first, by title and URL", () => {
  const artifacts = sessionArtifacts([
    ...publish("radius_artifact_create", "Release report", confirmed("r1", "https://r.test/r1")),
    ...publish("radius_artifact_create", "Eval results", confirmed("r2", "https://r.test/r2")),
  ]);
  assert.deepEqual(artifacts, [
    { id: "r2", title: "Eval results", url: "https://r.test/r2" },
    { id: "r1", title: "Release report", url: "https://r.test/r1" },
  ]);
});

test("an update lists its artifact once, under its latest title and at the top", () => {
  const artifacts = sessionArtifacts([
    ...publish("radius_artifact_create", "Draft", confirmed("r1", "https://r.test/r1")),
    ...publish("radius_artifact_create", "Other", confirmed("r2", "https://r.test/r2")),
    ...publish("radius_artifact_update", "Final report", confirmed("r1", "https://r.test/r1")),
  ]);
  assert.deepEqual(artifacts, [
    { id: "r1", title: "Final report", url: "https://r.test/r1" },
    { id: "r2", title: "Other", url: "https://r.test/r2" },
  ]);
});

test("failed, unconfirmed and read-only calls publish nothing", () => {
  const artifacts = sessionArtifacts([
    ...publish("radius_artifact_create", "Failed", { status: "error", message: "Denied." }),
    ...publish("radius_artifact_create", "Lost reply", {
      status: "unknown",
      message: "Inspect Radius.",
      artifactId: "r9",
      url: "https://r.test/r9",
    }),
    ...publish("radius_artifact_view", "Viewed", confirmed("r3", "https://r.test/r3"), false),
    ...publish("write", "A file", confirmed("r4", "https://r.test/r4"), false),
  ]);
  assert.deepEqual(artifacts, []);
});
