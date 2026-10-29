/**
 * Piano's `piano-project` extension, loaded the way Pi loads it, puts a project's instructions into the system
 * prompt of each run, in their own section, leaving Pi's other sections (the directory's
 * APPEND_SYSTEM.md among them) as they were.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import pianoProject from "../extensions/piano-project/index.ts";
import { PROJECT_INSTRUCTIONS_ENV, PROJECT_INSTRUCTIONS_SECTION } from "../shared/dispatch.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

/** Load the extension with `instructions` in its launch environment; returns its run-start handlers. */
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

/** A run's start as Pi hands it to handlers: the prompt sections they may change. */
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
