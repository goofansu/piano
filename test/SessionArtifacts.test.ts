import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RADIUS_ARTIFACT_CREATE_TOOL as create,
  RADIUS_ARTIFACT_UPDATE_TOOL as update,
  RADIUS_ARTIFACT_VIEW_TOOL as view,
  type RadiusArtifactResult,
} from "../shared/radiusArtifacts.ts";
import type { RenderMsg } from "../shared/wire.ts";
import { sessionArtifacts } from "../web/src/lib/sessionArtifacts.ts";

// Shapes as the radius-artifacts extension's calls and results reach the browser (PiRecords). Results
// are typed by the shared contract the extension returns, so renaming a field fails typecheck here.
let next = 0;
function publish(
  tool: string,
  title: string,
  result: RadiusArtifactResult,
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
const confirmed = (artifactId: string, url: string): RadiusArtifactResult => ({
  status: "confirmed",
  message: "Radius publication confirmed.",
  artifactId,
  url,
  revision: 1,
});

test("confirmed publications are listed newest first, by title and URL", () => {
  const artifacts = sessionArtifacts([
    ...publish(create, "Release report", confirmed("r1", "https://r.test/r1")),
    ...publish(create, "Eval results", confirmed("r2", "https://r.test/r2")),
  ]);
  assert.deepEqual(artifacts, [
    { id: "r2", title: "Eval results", url: "https://r.test/r2" },
    { id: "r1", title: "Release report", url: "https://r.test/r1" },
  ]);
});

test("an update lists its artifact once, under its latest title and at the top", () => {
  const artifacts = sessionArtifacts([
    ...publish(create, "Draft", confirmed("r1", "https://r.test/r1")),
    ...publish(create, "Other", confirmed("r2", "https://r.test/r2")),
    ...publish(update, "Final report", confirmed("r1", "https://r.test/r1")),
  ]);
  assert.deepEqual(artifacts, [
    { id: "r1", title: "Final report", url: "https://r.test/r1" },
    { id: "r2", title: "Other", url: "https://r.test/r2" },
  ]);
});

test("receipts join legacy direct publications without duplicates or codemode output scraping", () => {
  const messages: RenderMsg[] = [
    ...publish(create, "Old title", confirmed("r1", "https://r.test/r1")),
    ...publish(create, "Legacy only", confirmed("r2", "https://r.test/r2")),
    {
      id: "code",
      role: "tool_result",
      toolName: "codemode",
      text: JSON.stringify(confirmed("not-a-receipt", "https://r.test/no")),
    },
  ];
  assert.deepEqual(
    sessionArtifacts(messages, [
      {
        artifactId: "r1",
        title: "Updated title",
        url: "https://r.test/r1",
        revision: 2,
        operationKey: "update",
      },
    ]),
    [
      { id: "r1", title: "Updated title", url: "https://r.test/r1" },
      { id: "r2", title: "Legacy only", url: "https://r.test/r2" },
    ],
  );
});

test("failed, unconfirmed and read-only calls publish nothing", () => {
  const artifacts = sessionArtifacts([
    ...publish(create, "Failed", { status: "error", message: "Denied." }),
    ...publish(create, "Lost reply", {
      status: "unknown",
      message: "Inspect Radius.",
      artifactId: "r9",
      url: "https://r.test/r9",
    }),
    ...publish(view, "Viewed", confirmed("r3", "https://r.test/r3"), false),
    ...publish("write", "A file", confirmed("r4", "https://r.test/r4"), false),
  ]);
  assert.deepEqual(artifacts, []);
});
