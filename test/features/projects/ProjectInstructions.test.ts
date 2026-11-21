import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import pianoProject from "../../../extensions/piano-project/index.ts";
import {
  PROJECT_INSTRUCTIONS_ENV,
  PROJECT_INSTRUCTIONS_SECTION,
} from "../../../shared/features/dispatch/dispatch.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

function load(instructions: string | undefined): Handler[] {
  const handlers: Handler[] = [];
  const launch = { ...process.env };
  delete process.env[PROJECT_INSTRUCTIONS_ENV];
  if (instructions !== undefined) process.env[PROJECT_INSTRUCTIONS_ENV] = instructions;
  try {
    pianoProject({
      on: (event: string, handler: Handler) => {
        if (event === "before_agent_start") handlers.push(handler);
      },
    } as unknown as ExtensionAPI);
  } finally {
    process.env = launch;
  }
  return handlers;
}

const runStart = () => ({
  type: "before_agent_start",
  messageType: "user",
  prompt: "hi",
  systemPromptOptions: { appendSystemPrompt: "From APPEND_SYSTEM.md", sections: {} },
});

test("a project member's runs carry its instructions in a section of their own", async () => {
  const event = runStart();
  for (const handler of load("Answer in French.")) await handler(event, {});
  assert.deepEqual(event.systemPromptOptions, {
    appendSystemPrompt: "From APPEND_SYSTEM.md",
    sections: { [PROJECT_INSTRUCTIONS_SECTION]: "Answer in French." },
  });
});

test("a session without project instructions keeps Pi's system prompt as it is", async () => {
  for (const instructions of [undefined, ""]) {
    const event = runStart();
    for (const handler of load(instructions)) await handler(event, {});
    assert.deepEqual(event.systemPromptOptions, runStart().systemPromptOptions);
  }
});
